import { prisma } from "@/server/db/client";
import { enqueueOrReschedule } from "@/server/jobs";
import { defaultEntryStage, getOrgStages } from "@/server/services/pipeline";
import { linkAttributionToOpportunity } from "@/server/services/meta-attribution";
import { autoAssignLead } from "@/server/services/lead-assignment";

/**
 * Seguimiento automático de leads (Organization.autoTrackLeads).
 *
 * Sin esto, un chat nuevo solo llega a Seguimiento cuando el bot lo califica como "listo para agendar" o cuando
 * alguien lo crea a mano, y el análisis de la IA (calidad del lead, prioridad, siguiente pregunta…) solo corre si
 * alguien pulsa "Analizar". Con la opción encendida:
 *  - cada mensaje de un cliente que todavía no tiene ninguna oportunidad crea su tarjeta en la etapa de entrada
 *    (y la asigna por turnos si esa opción también está encendida);
 *  - se programa el análisis de la IA unos minutos después del último mensaje (cada mensaje nuevo lo empuja hacia
 *    adelante), así que se analiza la conversación ya con contenido y no un "hola" suelto, y se vuelve a analizar
 *    cuando el cliente sigue escribiendo.
 *
 * Nunca lanza: es un extra, no puede tumbar el guardado de un mensaje.
 */

/** Espera tras el último mensaje antes de analizar (el análisis cuesta créditos: no se hace uno por mensaje). */
export const ANALYSIS_DEBOUNCE_MS = 10 * 60 * 1000;

export async function trackLeadFromMessage(conversationId: string): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        contactId: true,
        customerName: true,
        customerPhone: true,
        bot: { select: { organizationId: true } },
      },
    });
    if (!conversation?.contactId) return;
    const organizationId = conversation.bot.organizationId;

    // Un cliente con alguna oportunidad (abierta, ganada, perdida o archivada) no es un lead nuevo: no se le crea otra
    // tarjeta por cada mensaje. Si tiene una abierta, esa es la que se analiza.
    const opportunities = await prisma.opportunity.findMany({
      where: { contactId: conversation.contactId },
      select: { id: true, archivedAt: true, stage: { select: { role: true } } },
      orderBy: { createdAt: "desc" },
    });
    let opportunityId = opportunities.find((o) => !o.archivedAt && o.stage.role === null)?.id ?? null;

    if (!opportunityId && opportunities.length === 0) {
      const entryStage = defaultEntryStage(await getOrgStages(organizationId));
      if (!entryStage) return;
      const contact = await prisma.contact.findUnique({ where: { id: conversation.contactId }, select: { fullName: true } });
      const created = await prisma.opportunity.create({
        data: {
          organizationId,
          contactId: conversation.contactId,
          stageId: entryStage.id,
          title: contact?.fullName || conversation.customerName || conversation.customerPhone,
          assignedToId: null,
        },
        select: { id: true },
      });
      opportunityId = created.id;
      await linkAttributionToOpportunity(conversationId, opportunityId);
      await autoAssignLead({ conversationId, opportunityId });
    }

    if (!opportunityId) return;
    await enqueueOrReschedule({
      type: "analyze_follow_up",
      uniqueKey: `analyze_follow_up:${opportunityId}`,
      payload: { opportunityId },
      runAfter: new Date(Date.now() + ANALYSIS_DEBOUNCE_MS),
    });
  } catch (error) {
    console.error("[lead-tracking] No se pudo dar seguimiento automático al chat:", error);
  }
}
