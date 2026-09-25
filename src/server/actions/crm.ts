"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { audit } from "@/server/services/audit";
import { ALL_LOSS_REASONS, type LossReason } from "@/lib/pipeline";
import { getOrgStages, defaultEntryStage, type PipelineStage } from "@/server/services/pipeline";
import { analyzeFollowUp } from "@/server/services/ai/follow-up";
import { isAiEnabled, isWithinBudget, spentToday } from "@/server/services/ai/client";
import { saveMediaFile, deleteMediaFile } from "@/lib/media-storage";
import { parseGuestEmails } from "@/lib/guest-emails";
import {
  createMeetEvent,
  updateMeetEvent,
  cancelMeetEvent,
  getOrCreateOrgCalendar,
  isGoogleMeetEnabled,
} from "@/server/services/google-calendar";
import { createUserMeetEvent, hasGoogleCalendarConnected } from "@/server/services/google-calendar-user";
import { scheduleMeetingBotJoin, cancelMeetingBotJoin, stopMeetingBot } from "@/server/services/meeting-bot";
import { requestMeetingSummaryPdf } from "@/server/services/meeting-transcript";
import { enqueue } from "@/server/jobs";
import type { ActionState } from "./types";

const PATH = "/dashboard/seguimiento";

async function requireOrg() {
  const session = await requireSession();
  if (!session.user.organizationId) throw new Error("Sin organización");
  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  return {
    organizationId: session.user.organizationId,
    userId: session.user.id,
    isAdmin,
  };
}

/**
 * El vendedor solo maneja su propia cartera; lo que el admin ya cargó (o
 * dejó sin asignar) lo puede editar cualquiera que lo tome. Evita que un
 * vendedor toque las filas de otro por error o a propósito.
 */
function canEditOpportunity(
  opportunity: { assignedToId: string | null },
  userId: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || opportunity.assignedToId === userId;
}

const createSchema = z
  .object({
    contactId: z.string().optional(),
    newContactName: z.string().max(160).optional(),
    newContactPhone: z.string().max(32).optional(),
    title: z.string().min(2, "Ponle un título").max(160),
    serviceInterest: z.string().max(160).optional(),
    estimatedValue: z.coerce.number().nonnegative().optional(),
    nextAction: z.string().max(300).optional(),
    nextActionAt: z.string().optional(),
    expectedCloseDate: z.string().optional(),
  })
  .refine((d) => d.contactId || d.newContactPhone, {
    message: "Elegí un contacto o cargá el teléfono de uno nuevo",
  });

export async function createOpportunityAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState & { opportunityId?: string }> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const parsed = createSchema.safeParse({
    contactId: formData.get("contactId") || undefined,
    newContactName: formData.get("newContactName") || undefined,
    newContactPhone: formData.get("newContactPhone") || undefined,
    title: formData.get("title"),
    serviceInterest: formData.get("serviceInterest") || undefined,
    estimatedValue: formData.get("estimatedValue") || undefined,
    nextAction: formData.get("nextAction") || undefined,
    nextActionAt: formData.get("nextActionAt") || undefined,
    expectedCloseDate: formData.get("expectedCloseDate") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  let contactId: string;
  if (parsed.data.newContactPhone) {
    // Lead que todavía no escribió por WhatsApp: se crea el contacto acá
    // mismo. El teléfono es la misma llave que usa el webhook, así que si
    // el cliente después escribe, se engancha solo a este mismo contacto
    // en vez de duplicarse.
    const phone = parsed.data.newContactPhone.trim();
    const contact = await prisma.contact.upsert({
      where: { organizationId_phone: { organizationId, phone } },
      create: {
        organizationId,
        phone,
        fullName: parsed.data.newContactName?.trim() || null,
        source: "Manual",
      },
      update: {},
    });
    contactId = contact.id;
  } else {
    const contact = await prisma.contact.findUnique({ where: { id: parsed.data.contactId! } });
    if (!contact || contact.organizationId !== organizationId) {
      return { error: "Contacto no encontrado" };
    }
    contactId = contact.id;
  }

  const entryStage = defaultEntryStage(await getOrgStages(organizationId));
  if (!entryStage) return { error: "La organización todavía no tiene etapas de pipeline configuradas" };

  const created = await prisma.opportunity.create({
    data: {
      organizationId,
      contactId,
      stageId: entryStage.id,
      title: parsed.data.title,
      serviceInterest: parsed.data.serviceInterest ?? null,
      estimatedValue: parsed.data.estimatedValue ?? null,
      nextAction: parsed.data.nextAction ?? null,
      nextActionAt: parsed.data.nextActionAt ? new Date(parsed.data.nextActionAt) : null,
      expectedCloseDate: parsed.data.expectedCloseDate ? new Date(parsed.data.expectedCloseDate) : null,
      // El admin carga clientes para el equipo: quedan sin asignar y
      // cualquier vendedor los puede tomar. Un vendedor que agrega uno
      // propio se lo asigna directo, como ya hacía antes.
      assignedToId: isAdmin ? null : userId,
    },
  });

  await audit({
    entityType: "Opportunity",
    entityId: created.id,
    action: "create",
    userId,
    organizationId,
    after: { title: created.title, stage: entryStage.label },
  });

  revalidatePath(PATH);
  return { error: null, message: "Cliente agregado.", opportunityId: created.id };
}

/**
 * Guarda una celda editada en la tabla de seguimiento. Es la forma en que
 * el equipo ya trabaja en su planilla: se corrige el dato en su lugar.
 */
const fieldSchema = z.discriminatedUnion("field", [
  // El valor de "stage" ahora es el id de una PipelineStage de la propia
  // organización (etapas configurables) — se valida perteneciendo a la
  // organización más abajo, no contra una lista fija.
  z.object({ field: z.literal("stage"), value: z.string().min(1) }),
  z.object({ field: z.literal("priority"), value: z.enum(["ALTA", "MEDIA", "BAJA"]) }),
  z.object({ field: z.literal("serviceInterest"), value: z.string().max(160) }),
  z.object({ field: z.literal("needSummary"), value: z.string().max(5000) }),
  z.object({ field: z.literal("lastUpdate"), value: z.string().max(5000) }),
  z.object({ field: z.literal("nextContactAt"), value: z.string() }),
  z.object({ field: z.literal("nextAction"), value: z.string().max(300) }),
  z.object({ field: z.literal("nextActionAt"), value: z.string() }),
  z.object({ field: z.literal("probability"), value: z.coerce.number().min(0).max(100) }),
  z.object({ field: z.literal("lostReason"), value: z.string().max(500) }),
  z.object({
    field: z.literal("lostReasonCategory"),
    value: z.union([z.enum(ALL_LOSS_REASONS as [LossReason, ...LossReason[]]), z.literal("")]),
  }),
  z.object({ field: z.literal("estimatedValue"), value: z.coerce.number().nonnegative() }),
  z.object({ field: z.literal("expectedCloseDate"), value: z.string() }),
  // "" = sin asignar (lo suelta el vendedor, o el admin lo deja libre para
  // que cualquiera lo tome). Cualquier otro valor debe ser un userId real.
  z.object({ field: z.literal("assignedToId"), value: z.string().max(60) }),
]);

export async function updateOpportunityFieldAction(
  opportunityId: string,
  field: string,
  value: string,
): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const parsed = fieldSchema.safeParse({ field, value });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Valor inválido" };

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: { stage: true },
  });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }

  // Reasignar tiene sus propias reglas (ver más abajo); el resto de los
  // campos solo los toca el dueño de la fila o el admin.
  if (parsed.data.field !== "assignedToId" && !canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  const now = new Date();
  const data: Record<string, unknown> = {};
  // Solo se resuelve cuando field === "stage" (ver case de abajo); se usa
  // después del update para el reporte a Meta y para la auditoría.
  let targetStage: PipelineStage | null = null;

  switch (parsed.data.field) {
    case "stage": {
      const stages = await getOrgStages(organizationId);
      targetStage = stages.find((s) => s.id === parsed.data.value) ?? null;
      if (!targetStage) return { error: "Etapa inválida" };
      data.stageId = targetStage.id;
      data.wonAt = targetStage.role === "WON" ? now : null;
      data.lostAt = targetStage.role === "LOST" ? now : null;
      // "Propuesta" es la etapa que representa preparar/mandar la cotización.
      if (targetStage.requiresProposalFields && !opportunity.proposalSentAt) data.proposalSentAt = now;
      break;
    }
    case "nextContactAt":
      data.nextContactAt = parsed.data.value ? new Date(parsed.data.value) : null;
      break;
    case "nextActionAt":
      data.nextActionAt = parsed.data.value ? new Date(parsed.data.value) : null;
      break;
    case "probability":
      data.probability = Math.round(parsed.data.value);
      break;
    case "estimatedValue":
      data.estimatedValue = parsed.data.value;
      break;
    case "expectedCloseDate":
      data.expectedCloseDate = parsed.data.value ? new Date(parsed.data.value) : null;
      break;
    case "lostReasonCategory":
      data.lostReasonCategory = parsed.data.value || null;
      break;
    case "assignedToId": {
      const targetId = parsed.data.value || null;
      if (isAdmin) {
        // El admin puede asignar a cualquiera del equipo, o soltarlo.
        if (targetId) {
          const target = await prisma.user.findUnique({ where: { id: targetId } });
          if (!target || target.organizationId !== organizationId) {
            return { error: "Ese usuario no pertenece a la organización" };
          }
        }
      } else if (targetId === userId) {
        // Tomar un cliente sin asignar.
        if (opportunity.assignedToId !== null) {
          return { error: "Ya lo tomó otro vendedor" };
        }
      } else if (targetId === null) {
        // Soltar un cliente propio, vuelve a quedar libre para el equipo.
        if (opportunity.assignedToId !== userId) {
          return { error: "No puedes soltar un cliente que no es tuyo" };
        }
      } else {
        return { error: "Solo el admin puede reasignar a otro vendedor" };
      }
      data.assignedToId = targetId;
      break;
    }
    default:
      data[parsed.data.field] = parsed.data.value || null;
  }

  await prisma.opportunity.update({ where: { id: opportunityId }, data });

  if (parsed.data.field === "stage" && targetStage?.role === "WON" && opportunity.stage.role !== "WON") {
    await enqueue({
      type: "meta_conversion_event",
      payload: { opportunityId, eventName: "Purchase" },
      uniqueKey: `meta-purchase-${opportunityId}`,
    });
  }

  // Manual §Meta Ads Regla 2: se considera "lead calificado" la primera vez
  // que una oportunidad deja la etapa de entrada por defecto -- antes era
  // literal "POR_CALIFICAR → ENTREVISTA"; ahora el pipeline es configurable
  // por organización, así que se generaliza a isDefaultEntry en vez de
  // comparar nombres fijos de etapa.
  if (
    parsed.data.field === "stage" &&
    targetStage &&
    opportunity.stage.isDefaultEntry &&
    !targetStage.isDefaultEntry &&
    !opportunity.qualifiedEventSentAt
  ) {
    await enqueue({
      type: "meta_conversion_event",
      payload: { opportunityId, eventName: "QualifiedLead" },
      uniqueKey: `meta-qualified-${opportunityId}`,
    });
  }

  // Solo se auditan los cambios de estado y de dueño: son los que después
  // explican el embudo. Auditar cada tecleo de una nota solo generaría ruido.
  if (parsed.data.field === "stage" && targetStage) {
    await audit({
      entityType: "Opportunity",
      entityId: opportunityId,
      action: "stage_change",
      userId,
      organizationId,
      before: { stage: opportunity.stage.label, stageId: opportunity.stage.id },
      after: { stage: targetStage.label, stageId: targetStage.id },
    });
  } else if (parsed.data.field === "assignedToId") {
    await audit({
      entityType: "Opportunity",
      entityId: opportunityId,
      action: "reassign",
      userId,
      organizationId,
      before: { assignedToId: opportunity.assignedToId },
      after: { assignedToId: data.assignedToId },
    });
  }

  revalidatePath(PATH);
  return { error: null };
}

export async function deleteOpportunityAction(opportunityId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }
  if (!canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  await prisma.opportunity.delete({ where: { id: opportunityId } });

  await audit({
    entityType: "Opportunity",
    entityId: opportunityId,
    action: "delete",
    userId,
    organizationId,
    before: { title: opportunity.title, stageId: opportunity.stageId },
  });

  revalidatePath(PATH);
  return { error: null };
}

/**
 * Archivar oculta al cliente de la vista principal sin borrar nada (a
 * diferencia de "Quitar del seguimiento", que sí elimina) — para leads
 * viejos/perdidos que ya no quieres ver pero podrías necesitar consultar.
 */
export async function archiveOpportunityAction(opportunityId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }
  if (!canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  await prisma.opportunity.update({ where: { id: opportunityId }, data: { archivedAt: new Date() } });
  revalidatePath(PATH);
  return { error: null };
}

export async function unarchiveOpportunityAction(opportunityId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }
  if (!canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  await prisma.opportunity.update({ where: { id: opportunityId }, data: { archivedAt: null } });
  revalidatePath(PATH);
  return { error: null };
}

/**
 * Guarda el orden manual (arrastrar y soltar) de la cartera completa —
 * es compartida por todo el equipo, como el resto de la planilla.
 */
export async function reorderOpportunitiesAction(orderedIds: string[]): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const owned = await prisma.opportunity.findMany({
    where: { id: { in: orderedIds }, organizationId },
    select: { id: true },
  });
  if (owned.length !== orderedIds.length) {
    return { error: "Alguno de estos clientes ya no existe. Recarga la página." };
  }

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.opportunity.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  revalidatePath(PATH);
  return { error: null };
}

// ── Reuniones ───────────────────────────────────────────────────────────
// Registro manual de reuniones (fecha + transcripción/notas) mientras no
// haya integración automática con Meet. El asesor IA las lee como fuente
// prioritaria — declaraciones directas del lead — al calificar el lead.

// 100k caracteres ≈ 60-70 páginas de texto — de sobra para la transcripción
// literal de una reunión larga, con mensaje de error en español (antes
// caían en el texto en inglés por defecto de Zod).
const MEETING_NOTES_MAX = 100_000;
const meetingNotesField = z
  .string()
  .max(MEETING_NOTES_MAX, `Máximo ${MEETING_NOTES_MAX.toLocaleString("es")} caracteres.`);

const createMeetingSchema = z.object({
  opportunityId: z.string().min(1),
  title: z.string().max(160).optional(),
  scheduledAt: z.string().min(1, "Poné la fecha"),
  durationMinutes: z.coerce.number().int().positive().max(600).optional(),
  meetingUrl: z.string().max(500).optional(),
  withGoogleMeet: z.coerce.boolean().optional(),
  guestEmails: z.string().max(2000).optional(),
  botEnabled: z.coerce.boolean().optional(),
  notes: meetingNotesField.optional(), // transcripción o resumen de la reunión
});

export async function createMeetingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const parsed = createMeetingSchema.safeParse({
    opportunityId: formData.get("opportunityId"),
    title: formData.get("title") || undefined,
    scheduledAt: formData.get("scheduledAt"),
    durationMinutes: formData.get("durationMinutes") || undefined,
    meetingUrl: formData.get("meetingUrl") || undefined,
    withGoogleMeet: formData.get("withGoogleMeet") || undefined,
    guestEmails: formData.get("guestEmails") || undefined,
    botEnabled: formData.has("botEnabled") ? "true" : "false",
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const guestEmailsResult = parseGuestEmails(parsed.data.guestEmails);
  if ("error" in guestEmailsResult) {
    return { error: guestEmailsResult.error };
  }

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: parsed.data.opportunityId },
    select: {
      organizationId: true,
      assignedToId: true,
      title: true,
      contact: { select: { fullName: true, phone: true } },
      organization: { select: { name: true } },
    },
  });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }
  if (!canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { error: "Fecha inválida" };
  }

  const durationMinutes = parsed.data.durationMinutes ?? 30;
  let meetingUrl = parsed.data.meetingUrl || null;
  let googleEventId: string | null = null;
  let googleCalendarOwnerId: string | null = null;
  const botEnabled = parsed.data.botEnabled ?? true;
  const summary = `Reunión con ${opportunity.contact.fullName || opportunity.contact.phone} — ${opportunity.title}`;

  // Mismo criterio que adhoc-meetings.ts: si quien crea la reunión conectó
  // su Google Calendar personal, TODA reunión que cree se refleja ahí --
  // tenga link propio, generado, o ninguno. Si no lo conectó, sigue el
  // comportamiento de antes (calendario compartido, solo con el checkbox).
  const useOwnCalendar = await hasGoogleCalendarConnected(userId);
  if (useOwnCalendar) {
    try {
      const event = await createUserMeetEvent({
        userId,
        summary,
        scheduledAt,
        durationMinutes,
        attendeeEmails: guestEmailsResult.emails,
        existingMeetingUrl: meetingUrl,
        generateMeetLink: Boolean(parsed.data.withGoogleMeet) && !meetingUrl,
      });
      if (event.meetingUrl) meetingUrl = event.meetingUrl;
      googleEventId = event.eventId;
      googleCalendarOwnerId = userId;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "No se pudo crear el evento en Google Calendar." };
    }
  } else if (!meetingUrl && parsed.data.withGoogleMeet) {
    if (!isGoogleMeetEnabled()) {
      return { error: "Google Meet no está configurado en el servidor. Contactá al administrador." };
    }
    try {
      const calendarId = await getOrCreateOrgCalendar(organizationId, opportunity.organization.name);
      const event = await createMeetEvent({
        calendarId,
        summary,
        scheduledAt,
        durationMinutes,
        attendeeEmails: guestEmailsResult.emails,
      });
      meetingUrl = event.meetingUrl;
      googleEventId = event.eventId;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "No se pudo crear el evento en Google Calendar." };
    }
  }

  const meeting = await prisma.meeting.create({
    data: {
      organizationId,
      opportunityId: parsed.data.opportunityId,
      title:
        parsed.data.title?.trim() ||
        `Reunión con ${opportunity.contact.fullName || opportunity.contact.phone}`,
      scheduledAt,
      durationMinutes,
      meetingUrl,
      googleEventId,
      googleCalendarOwnerId,
      guestEmails: guestEmailsResult.emails,
      botEnabled,
      notes: parsed.data.notes || null,
      status: parsed.data.notes ? "DONE" : "SCHEDULED",
    },
  });

  if (meetingUrl && botEnabled) {
    await scheduleMeetingBotJoin(meeting.id, scheduledAt);
  }

  revalidatePath(PATH);
  return { error: null, message: "Reunión registrada." };
}

const updateMeetingNotesSchema = z.object({
  notes: meetingNotesField,
});

/** Carga o edita la transcripción/resumen de una reunión ya registrada. */
export async function updateMeetingNotesAction(
  meetingId: string,
  notes: string,
): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { opportunity: { select: { assignedToId: true } } },
  });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }
  if (meeting.opportunity && !canEditOpportunity(meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  const parsed = updateMeetingNotesSchema.safeParse({ notes });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      notes: parsed.data.notes || null,
      status: parsed.data.notes && meeting.status === "SCHEDULED" ? "DONE" : meeting.status,
    },
  });

  revalidatePath(PATH);
  return { error: null };
}

/**
 * Solo el nombre -- para el renombrado rápido en la lista (ej. "Reunión
 * Extensión" -> "Reunión con Juanito"), sin el formulario completo de
 * updateMeetingAction y sin su restricción de "no editable si ya está
 * cancelada/realizada" (identificarla mejor después tiene sentido siempre).
 */
export async function renameMeetingAction(meetingId: string, title: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const trimmed = title.trim();
  if (!trimmed) return { error: "Poné un nombre" };
  if (trimmed.length > 160) return { error: "Nombre muy largo" };

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { opportunity: { select: { assignedToId: true } } },
  });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }
  if (meeting.opportunity && !canEditOpportunity(meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  await prisma.meeting.update({ where: { id: meetingId }, data: { title: trimmed } });
  revalidatePath(PATH);
  return { error: null };
}

export async function deleteMeetingAction(meetingId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { opportunity: { select: { assignedToId: true } }, attachments: true },
  });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }
  if (meeting.opportunity && !canEditOpportunity(meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  await prisma.meeting.delete({ where: { id: meetingId } });
  await Promise.all(meeting.attachments.map((a) => deleteMediaFile(a.url)));
  await cancelMeetingBotJoin(meetingId);
  if (meeting.googleEventId) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { googleCalendarId: true } });
    if (org?.googleCalendarId) {
      await cancelMeetEvent({ calendarId: org.googleCalendarId, eventId: meeting.googleEventId }).catch(() => {});
    }
  }
  revalidatePath(PATH);
  return { error: null };
}

const updateMeetingSchema = z.object({
  title: z.string().max(160).optional(),
  scheduledAt: z.string().min(1, "Poné la fecha"),
  durationMinutes: z.coerce.number().int().positive().max(600),
  meetingUrl: z.string().max(500).optional(),
  botEnabled: z.coerce.boolean().optional(),
});

/**
 * Cambiar nombre, link, fecha/hora, duración o si el bot se une. El nombre y
 * el link son solo de nuestra base -- a propósito no se tocan en el evento
 * real de Calendar (si lo hay), que sigue siendo el que se creó al agendar;
 * esto es para poder corregir a mano una reunión (por ej. una que agendó el
 * bot sin link) sin depender de la integración de Calendar para eso.
 */
export async function updateMeetingAction(meetingId: string, formData: FormData): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { opportunity: { select: { assignedToId: true } } },
  });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }
  if (meeting.opportunity && !canEditOpportunity(meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  const parsed = updateMeetingSchema.safeParse({
    title: formData.get("title") || undefined,
    scheduledAt: formData.get("scheduledAt"),
    durationMinutes: formData.get("durationMinutes"),
    meetingUrl: formData.get("meetingUrl") || undefined,
    botEnabled: formData.has("botEnabled") ? formData.get("botEnabled") : undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { error: "Fecha inválida" };
  }
  const botEnabled = parsed.data.botEnabled ?? false;
  const meetingUrl = parsed.data.meetingUrl?.trim() || null;

  if (meeting.googleEventId) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { googleCalendarId: true } });
    if (org?.googleCalendarId) {
      try {
        await updateMeetEvent({
          calendarId: org.googleCalendarId,
          eventId: meeting.googleEventId,
          scheduledAt,
          durationMinutes: parsed.data.durationMinutes,
        });
      } catch (error) {
        return { error: error instanceof Error ? error.message : "No se pudo actualizar el evento en Google Calendar." };
      }
    }
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      title: parsed.data.title?.trim() || meeting.title,
      scheduledAt,
      durationMinutes: parsed.data.durationMinutes,
      meetingUrl,
      botEnabled,
    },
  });

  // Con el link nuevo (no el de antes de este guardado) -- si recién ahora
  // se cargó el link a mano, el bot tiene que empezar a poder unirse.
  if (meetingUrl && botEnabled) {
    await scheduleMeetingBotJoin(meetingId, scheduledAt);
  } else {
    await cancelMeetingBotJoin(meetingId);
  }

  revalidatePath(PATH);
  return { error: null, message: "Reunión actualizada." };
}

/** Cancela la reunión (no la borra) — si tiene evento de Calendar, lo cancela y avisa a los invitados. */
export async function cancelMeetingAction(meetingId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { opportunity: { select: { assignedToId: true } } },
  });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }
  if (meeting.opportunity && !canEditOpportunity(meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  if (meeting.googleEventId) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { googleCalendarId: true } });
    if (org?.googleCalendarId) {
      await cancelMeetEvent({ calendarId: org.googleCalendarId, eventId: meeting.googleEventId }).catch(() => {});
    }
  }

  await cancelMeetingBotJoin(meetingId);
  await prisma.meeting.update({ where: { id: meetingId }, data: { status: "CANCELED" } });

  revalidatePath(PATH);
  return { error: null, message: "Reunión cancelada." };
}

export async function stopMeetingBotAction(meetingId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { opportunity: { select: { assignedToId: true } } },
  });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }
  if (meeting.opportunity && !canEditOpportunity(meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  const result = await stopMeetingBot(meetingId);
  if (!result.ok) {
    return { error: result.error ?? "No se pudo detener el bot" };
  }

  revalidatePath(PATH);
  return { error: null, message: "Avisado — el bot debería salir en breve." };
}

export async function generateMeetingSummaryPdfAction(meetingId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { opportunity: { select: { assignedToId: true } } },
  });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }
  if (meeting.opportunity && !canEditOpportunity(meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  const result = await requestMeetingSummaryPdf(meetingId, organizationId);
  if (!result.ok) return { error: result.error ?? "No se pudo generar el resumen" };

  revalidatePath(PATH);
  return { error: null, message: "Resumen en PDF generado." };
}

// Mismos límites que ya usa el inbox para adjuntos salientes — ver
// MAX_SIZE_BY_TYPE en server/actions/inbox.ts.
const MEETING_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
const MEETING_ATTACHMENTS_PER_MEETING = 20;

/** Sube uno o más archivos (audio, PDF, capturas) ligados a una reunión. */
export async function addMeetingAttachmentAction(
  meetingId: string,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { opportunity: { select: { assignedToId: true } }, _count: { select: { attachments: true } } },
  });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }
  if (meeting.opportunity && !canEditOpportunity(meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }
  if (meeting._count.attachments >= MEETING_ATTACHMENTS_PER_MEETING) {
    return { error: `Máximo ${MEETING_ATTACHMENTS_PER_MEETING} archivos por reunión.` };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "Archivo inválido" };
  }
  if (file.size > MEETING_ATTACHMENT_MAX_BYTES) {
    return { error: "El archivo supera el límite de 100MB." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const url = await saveMediaFile(buffer, mimeType);

  await prisma.meetingAttachment.create({
    data: { meetingId, url, fileName: file.name, mimeType, fileSize: file.size },
  });

  revalidatePath(PATH);
  revalidatePath("/dashboard/reuniones");
  return { error: null };
}

export async function deleteMeetingAttachmentAction(attachmentId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const attachment = await prisma.meetingAttachment.findUnique({
    where: { id: attachmentId },
    include: { meeting: { include: { opportunity: { select: { assignedToId: true } } } } },
  });
  if (!attachment || attachment.meeting.organizationId !== organizationId) {
    return { error: "Archivo no encontrado" };
  }
  if (attachment.meeting.opportunity && !canEditOpportunity(attachment.meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  await prisma.meetingAttachment.delete({ where: { id: attachmentId } });
  await deleteMediaFile(attachment.url);

  revalidatePath(PATH);
  revalidatePath("/dashboard/reuniones");
  return { error: null };
}

export async function completeActivityAction(activityId: string): Promise<ActionState> {
  const { organizationId, userId } = await requireOrg();

  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity || activity.organizationId !== organizationId) {
    return { error: "Tarea no encontrada" };
  }

  await prisma.activity.update({
    where: { id: activityId },
    data: { status: "DONE", completedAt: new Date() },
  });

  await audit({
    entityType: "Activity",
    entityId: activityId,
    action: "complete",
    userId,
    organizationId,
  });

  revalidatePath(PATH);
  return { error: null };
}

/** Clientes activos sin próximo contacto agendado. */
export async function countWithoutNextContact(organizationId: string): Promise<number> {
  return prisma.opportunity.count({
    where: {
      organizationId,
      stage: { role: null },
      nextContactAt: null,
    },
  });
}

/**
 * Pide un análisis del asesor IA para un cliente. Se ejecuta al momento
 * (no encolado) porque el vendedor está esperando el resultado en pantalla.
 */
export async function analyzeOpportunityAction(
  opportunityId: string,
): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: { organizationId: true, assignedToId: true },
  });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }
  if (!canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  if (!isAiEnabled()) {
    return { error: "El asesor IA no está configurado. Falta OPENAI_API_KEY." };
  }

  if (!(await isWithinBudget(organizationId))) {
    return {
      error: "Se alcanzó el tope de gasto diario de IA. Vuelve a intentar mañana.",
    };
  }

  try {
    await analyzeFollowUp(opportunityId);
  } catch (error) {
    console.error("[crm] Falló el análisis:", error);
    return { error: "No se pudo analizar. Intenta de nuevo en un momento." };
  }

  revalidatePath(PATH);
  return { error: null, message: "Análisis listo." };
}

/** Gasto de IA de hoy, para mostrarlo junto al tope configurado. */
export async function getAiSpendToday(organizationId: string) {
  return {
    spent: await spentToday(organizationId),
    budget: Number(process.env.AI_DAILY_BUDGET_USD ?? 2),
    enabled: isAiEnabled(),
  };
}
