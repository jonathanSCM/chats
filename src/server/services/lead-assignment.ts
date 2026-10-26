import { prisma } from "@/server/db/client";
import { audit } from "@/server/services/audit";
import { sendPushToUser } from "@/server/services/push";
import { chooseNextAssignee, slaAction } from "@/lib/lead-assignment";

/**
 * Asignación automática de leads (F14).
 *
 *  - `autoAssignLead`: reparte por turnos entre los vendedores marcados como disponibles. Se
 *    llama cuando el bot crea la oportunidad o llega un chat que nadie va a atender con bot.
 *    Nunca toca una conversación que ya tiene dueño (lo manual manda) y nunca lanza: asignar es
 *    un extra, no puede tumbar el guardado de un mensaje ni de una oportunidad.
 *  - `sweepLeadSla`: lo corre el cron. Reintenta asignar lo que quedó sin dueño, avisa cuando un
 *    cliente espera respuesta humana más del plazo y, al doble, reasigna (una sola vez).
 */

const WAITING_WINDOW_MS = 24 * 60 * 60 * 1000;

interface OrgAssignSettings {
  autoAssignEnabled: boolean;
  autoAssignMaxOpen: number | null;
  autoAssignSlaMinutes: number;
}

async function pickSeller(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  organizationId: string,
  settings: OrgAssignSettings,
  lastUserId: string | null,
  excludeUserIds: string[],
): Promise<string | null> {
  const members = await tx.organizationMembership.findMany({
    where: { organizationId, availableForLeads: true, user: { role: { notIn: ["SYSTEM", "SUPERADMIN"] } } },
    select: { userId: true },
  });
  if (members.length === 0) return null;

  const ids = members.map((m) => m.userId);
  const open = await tx.opportunity.groupBy({
    by: ["assignedToId"],
    where: { organizationId, assignedToId: { in: ids }, archivedAt: null, stage: { role: null } },
    _count: { _all: true },
  });
  const openByUser = new Map(open.map((o) => [o.assignedToId, o._count._all]));

  return chooseNextAssignee(
    ids.map((userId) => ({ userId, openCount: openByUser.get(userId) ?? 0 })),
    lastUserId,
    settings.autoAssignMaxOpen,
    excludeUserIds,
  );
}

function customerLabel(c: { customerName: string | null; customerPhone: string }): string {
  return c.customerName || c.customerPhone;
}

/** Asigna la conversación (y su oportunidad, si ya existe y no tiene dueño). Devuelve el vendedor o null. */
export async function autoAssignLead(params: {
  conversationId: string;
  opportunityId?: string | null;
  excludeUserIds?: string[];
  /** Reasignación por falta de respuesta: se permite aunque ya tenga dueño automático. */
  reassignFrom?: string | null;
}): Promise<string | null> {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: params.conversationId },
      select: {
        assignedToId: true,
        customerName: true,
        customerPhone: true,
        contactId: true,
        bot: { select: { organizationId: true } },
      },
    });
    if (!conv) return null;
    const organizationId = conv.bot.organizationId;

    const outcome = await prisma.$transaction(async (tx) => {
      // Se bloquea la fila de la organización: dos leads simultáneos no pueden caer en el mismo turno.
      await tx.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${organizationId} FOR UPDATE`;

      const org = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { autoAssignEnabled: true, autoAssignMaxOpen: true, autoAssignSlaMinutes: true, autoAssignLastUserId: true },
      });
      if (!org?.autoAssignEnabled) return null;

      const fresh = await tx.conversation.findUnique({ where: { id: params.conversationId }, select: { assignedToId: true } });
      const isReassign = params.reassignFrom !== undefined && params.reassignFrom !== null;
      if (fresh?.assignedToId && !isReassign) {
        // Ya tiene dueño: solo se alinea la oportunidad si quedó sin responsable.
        if (params.opportunityId) {
          await tx.opportunity.updateMany({ where: { id: params.opportunityId, assignedToId: null }, data: { assignedToId: fresh.assignedToId } });
        }
        return null;
      }
      if (isReassign && fresh?.assignedToId !== params.reassignFrom) return null; // alguien la movió mientras tanto

      const next = await pickSeller(tx, organizationId, org, org.autoAssignLastUserId, params.excludeUserIds ?? []);
      if (!next) return null;

      const now = new Date();
      await tx.conversation.update({
        where: { id: params.conversationId },
        data: {
          assignedToId: next,
          assignedAt: now,
          autoAssigned: true,
          slaAlertedAt: null,
          ...(isReassign ? { slaReassignedAt: now } : { slaReassignedAt: null }),
        },
      });
      if (params.opportunityId) {
        await tx.opportunity.updateMany({ where: { id: params.opportunityId, assignedToId: null }, data: { assignedToId: next } });
      }
      if (isReassign && conv.contactId) {
        await tx.opportunity.updateMany({
          where: { contactId: conv.contactId, assignedToId: params.reassignFrom, archivedAt: null, stage: { role: null } },
          data: { assignedToId: next },
        });
      }
      await tx.organization.update({ where: { id: organizationId }, data: { autoAssignLastUserId: next } });
      return next;
    });

    if (!outcome) return null;

    await audit({
      entityType: "Conversation",
      entityId: params.conversationId,
      action: params.reassignFrom ? "auto_reassigned" : "auto_assigned",
      actor: "SYSTEM",
      organizationId,
      before: { assignedToId: params.reassignFrom ?? null },
      after: { assignedToId: outcome },
    });
    await sendPushToUser(outcome, {
      title: "Nuevo lead asignado",
      body: `${customerLabel(conv)} es tuyo. Respóndele pronto.`,
      conversationId: params.conversationId,
    });
    return outcome;
  } catch (error) {
    console.error("[lead-assignment] No se pudo asignar:", error);
    return null;
  }
}

interface WaitingRow {
  id: string;
  assignedToId: string;
  waitingSince: Date;
  slaAlertedAt: Date | null;
  slaReassignedAt: Date | null;
  autoAssigned: boolean;
  customerName: string | null;
  customerPhone: string;
}

async function adminIds(organizationId: string): Promise<string[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: { organizationId, role: "OWNER", user: { role: { notIn: ["SYSTEM", "SUPERADMIN"] } } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

async function sweepOrganization(organizationId: string, slaMinutes: number): Promise<void> {
  const now = new Date();
  const waitingAfter = new Date(now.getTime() - WAITING_WINDOW_MS);

  // 1) Chats que esperan a una persona y siguen sin dueño (no había nadie disponible): se reintenta.
  const unassigned = await prisma.conversation.findMany({
    where: {
      bot: { organizationId },
      botPaused: true,
      assignedToId: null,
      lastMessageAt: { gt: waitingAfter },
    },
    select: { id: true },
    take: 20,
  });
  for (const c of unassigned) await autoAssignLead({ conversationId: c.id });

  // 2) Clientes cuyo último mensaje lleva más del plazo sin respuesta humana.
  const cutoff = new Date(now.getTime() - slaMinutes * 60_000);
  const rows = await prisma.$queryRaw<WaitingRow[]>`
    SELECT c."id", c."assignedToId", lc."at" AS "waitingSince", c."slaAlertedAt", c."slaReassignedAt",
           c."autoAssigned", c."customerName", c."customerPhone"
      FROM "conversations" c
      JOIN "bots" b ON b."id" = c."botId"
      JOIN LATERAL (SELECT max(m."createdAt") AS "at" FROM "messages" m WHERE m."conversationId" = c."id" AND m."role" = 'CUSTOMER') lc ON true
      LEFT JOIN LATERAL (SELECT max(m."createdAt") AS "at" FROM "messages" m WHERE m."conversationId" = c."id" AND m."role" = 'STAFF') ls ON true
     WHERE b."organizationId" = ${organizationId}
       AND c."botPaused" = true
       AND c."assignedToId" IS NOT NULL
       AND lc."at" IS NOT NULL
       AND (ls."at" IS NULL OR ls."at" < lc."at")
       AND lc."at" > ${waitingAfter}
       AND lc."at" < ${cutoff}
     LIMIT 50`;

  for (const row of rows) {
    const action = slaAction({
      waitingSince: new Date(row.waitingSince),
      now,
      slaMinutes,
      alertedAt: row.slaAlertedAt ? new Date(row.slaAlertedAt) : null,
      reassignedAt: row.slaReassignedAt ? new Date(row.slaReassignedAt) : null,
      autoAssigned: row.autoAssigned,
    });
    if (action === "none") continue;

    const label = customerLabel(row);
    const minutes = Math.round((now.getTime() - new Date(row.waitingSince).getTime()) / 60_000);

    if (action === "alert") {
      await prisma.conversation.update({ where: { id: row.id }, data: { slaAlertedAt: now } });
      const targets = [...new Set([row.assignedToId, ...(await adminIds(organizationId))])];
      await Promise.all(
        targets.map((userId) =>
          sendPushToUser(userId, {
            title: "Cliente esperando respuesta",
            body: `${label} lleva ${minutes} min sin respuesta.`,
            conversationId: row.id,
          }),
        ),
      );
      await audit({ entityType: "Conversation", entityId: row.id, action: "sla_alert", actor: "SYSTEM", organizationId, after: { minutes } });
      continue;
    }

    // reassign
    const next = await autoAssignLead({ conversationId: row.id, reassignFrom: row.assignedToId, excludeUserIds: [row.assignedToId] });
    if (!next) {
      // No había a quién pasárselo: se marca para no insistir en cada pasada.
      await prisma.conversation.update({ where: { id: row.id }, data: { slaReassignedAt: now } });
      continue;
    }
    const admins = await adminIds(organizationId);
    await Promise.all(
      [row.assignedToId, ...admins].map((userId) =>
        sendPushToUser(userId, {
          title: "Lead reasignado",
          body: `${label} pasó a otro vendedor por falta de respuesta (${minutes} min).`,
          conversationId: row.id,
        }),
      ),
    );
  }
}

/** Lo llama el cron en cada pasada; barato: solo mira organizaciones que encendieron la función. */
export async function sweepLeadSla(): Promise<void> {
  const orgs = await prisma.organization.findMany({
    where: { autoAssignEnabled: true, suspended: false },
    select: { id: true, autoAssignSlaMinutes: true },
  });
  for (const org of orgs) {
    try {
      await sweepOrganization(org.id, org.autoAssignSlaMinutes);
    } catch (error) {
      console.error(`[lead-assignment] Falló el barrido de ${org.id}:`, error);
    }
  }
}
