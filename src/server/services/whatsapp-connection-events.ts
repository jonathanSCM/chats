import { prisma } from "@/server/db/client";
import { audit } from "@/server/services/audit";
import { decrypt } from "@/lib/crypto";
import { describeDisconnection, unsubscribeAppFromWaba, type ParsedAccountUpdate } from "@/server/services/whatsapp";

/**
 * Intento (nunca falla la desconexión): pedirle a Meta que deje de mandar los avisos de esta cuenta. Solo si la conexión
 * seguía activa -- si Meta ya la desconectó (PARTNER_REMOVED), el token ya no sirve y no hay nada que cancelar.
 */
export async function unsubscribeConnectionFromMeta(botId: string): Promise<void> {
  try {
    const connection = await prisma.whatsAppConnection.findUnique({
      where: { botId },
      select: { wabaId: true, accessToken: true, verified: true },
    });
    if (!connection?.verified || !connection.wabaId) return;
    await unsubscribeAppFromWaba({ wabaId: connection.wabaId, accessToken: decrypt(connection.accessToken) });
  } catch (error) {
    console.warn(`[whatsapp] No se pudo cancelar la suscripción en Meta al desconectar ${botId}:`, error);
  }
}

/**
 * Meta avisa (account_update) cuando algo cambia en la cuenta de WhatsApp Business de un número conectado.
 *  - PARTNER_REMOVED: el número se desconectó de la plataforma (a mano desde el celular, por inactividad o por cambio de
 *    plan). Desde ese momento el token ya no sirve: la conexión pasa a "desconectada" con el motivo a la vista, y no se
 *    envía nada hasta que se reconecte o se quite.
 *  - ACCOUNT_OFFBOARDED: cambio de celular o reinstalación; Meta lo recupera solo en minutos, no se toca nada.
 * Devuelve cuántas conexiones se marcaron como desconectadas.
 */
export async function handleAccountUpdate(update: ParsedAccountUpdate): Promise<number> {
  if (update.event !== "PARTNER_REMOVED") return 0;

  const connections = await prisma.whatsAppConnection.findMany({
    where: { wabaId: update.wabaId, verified: true },
    select: { id: true, botId: true, bot: { select: { organizationId: true } } },
  });
  if (connections.length === 0) return 0;

  const reason = describeDisconnection(update.disconnectionReason, update.disconnectionInitiatedBy);
  await prisma.whatsAppConnection.updateMany({
    where: { id: { in: connections.map((c) => c.id) } },
    data: { verified: false, disconnectedAt: new Date(), disconnectReason: reason },
  });

  for (const connection of connections) {
    await audit({
      entityType: "WhatsAppConnection",
      entityId: connection.botId,
      action: "whatsapp_partner_removed",
      actor: "SYSTEM",
      organizationId: connection.bot.organizationId,
      after: { reason: update.disconnectionReason, initiatedBy: update.disconnectionInitiatedBy },
    });
  }
  return connections.length;
}
