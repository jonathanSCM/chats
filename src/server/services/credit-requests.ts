import { prisma } from "@/server/db/client";
import { audit } from "@/server/services/audit";
import { addCreditPack } from "@/server/services/ai/credits";
import { renewPlan } from "@/server/services/plans";

export type RequestKind = "CREDITS" | "RENEWAL";

export const MIN_REQUEST_CREDITS = 100;
export const MAX_REQUEST_CREDITS = 1_000_000;
/** Cuántas solicitudes pendientes puede tener una organización a la vez (evita que se llene de repetidas). */
export const MAX_PENDING_PER_ORG = 3;

/** Una suborganización pide a nombre de su organización principal, que es la dueña de la bolsa y del plan. */
async function rootOf(organizationId: string): Promise<{ id: string; name: string; aiCreditsMonthly: number | null } | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      aiCreditsMonthly: true,
      parent: { select: { id: true, name: true, aiCreditsMonthly: true } },
    },
  });
  if (!org) return null;
  return org.parent ?? org;
}

/** El dueño pide más créditos o la renovación de su plan. Queda pendiente hasta que el superadmin la atienda. */
export async function createRequest(input: {
  organizationId: string;
  userId: string;
  kind: RequestKind;
  credits?: number | null;
  note?: string | null;
}): Promise<{ error: string } | { id: string }> {
  const root = await rootOf(input.organizationId);
  if (!root) return { error: "Organización no encontrada." };

  if (input.kind === "CREDITS") {
    const c = input.credits;
    if (!c || !Number.isInteger(c) || c < MIN_REQUEST_CREDITS || c > MAX_REQUEST_CREDITS) {
      return { error: `Pide entre ${MIN_REQUEST_CREDITS.toLocaleString("es")} y ${MAX_REQUEST_CREDITS.toLocaleString("es")} créditos.` };
    }
  }

  const pending = await prisma.creditRequest.count({ where: { organizationId: input.organizationId, status: "PENDING" } });
  if (pending >= MAX_PENDING_PER_ORG) {
    return { error: "Ya tienes varias solicitudes pendientes. Espera a que las atiendan antes de enviar otra." };
  }

  const note = input.note?.trim().slice(0, 300) || null;
  const request = await prisma.creditRequest.create({
    data: {
      organizationId: input.organizationId,
      requestedById: input.userId,
      kind: input.kind,
      credits: input.kind === "CREDITS" ? input.credits! : null,
      note,
    },
  });
  await audit({
    entityType: "CreditRequest",
    entityId: request.id,
    action: "credit_request_created",
    userId: input.userId,
    organizationId: input.organizationId,
    after: { kind: input.kind, credits: request.credits, note },
  });
  return { id: request.id };
}

export async function countPendingRequests(): Promise<number> {
  return prisma.creditRequest.count({ where: { status: "PENDING" } });
}

export interface RequestRow {
  id: string;
  kind: RequestKind;
  credits: number | null;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedNote: string | null;
  organizationId: string;
  organizationName: string;
  /** Quién la pidió. */
  requestedBy: string | null;
}

export async function listRequests(opts: { status?: "PENDING" | "RESOLVED"; limit?: number; organizationId?: string } = {}): Promise<RequestRow[]> {
  const rows = await prisma.creditRequest.findMany({
    where: {
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      ...(opts.status === "PENDING" ? { status: "PENDING" } : opts.status === "RESOLVED" ? { status: { not: "PENDING" } } : {}),
    },
    orderBy: opts.status === "RESOLVED" ? { resolvedAt: "desc" } : { createdAt: "desc" },
    take: opts.limit ?? 50,
    include: { organization: { select: { name: true } } },
  });
  const userIds = [...new Set(rows.map((r) => r.requestedById).filter((x): x is string => Boolean(x)))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = (id: string | null) => {
    if (!id) return null;
    const u = users.find((x) => x.id === id);
    return u ? u.name || u.email : null;
  };
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as RequestKind,
    credits: r.credits,
    note: r.note,
    status: r.status as RequestRow["status"],
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    resolvedNote: r.resolvedNote,
    organizationId: r.organizationId,
    organizationName: r.organization.name,
    requestedBy: nameOf(r.requestedById),
  }));
}

/**
 * Aprueba una solicitud: si pedía créditos se carga un paquete (90 días) en la organización dueña de la bolsa; si pedía
 * renovar el plan se corre un mes su vencimiento. El pago se recibe por otro medio: aprobar es lo que activa.
 */
export async function approveRequest(requestId: string, actorId: string, now = new Date()): Promise<{ error: string } | { message: string }> {
  const request = await prisma.creditRequest.findUnique({ where: { id: requestId } });
  if (!request) return { error: "Solicitud no encontrada." };
  if (request.status !== "PENDING") return { error: "Esta solicitud ya fue atendida." };
  const root = await rootOf(request.organizationId);
  if (!root) return { error: "Organización no encontrada." };

  let message: string;
  if (request.kind === "CREDITS") {
    if (root.aiCreditsMonthly === null) {
      return { error: "La organización no tiene créditos por mes definidos: define su plan de créditos antes de cargar una recarga." };
    }
    await addCreditPack({ organizationId: root.id, credits: request.credits ?? 0, note: "Solicitud aprobada", createdById: actorId, now });
    message = `Se cargaron ${(request.credits ?? 0).toLocaleString("es")} créditos a ${root.name}.`;
  } else {
    const renewed = await renewPlan(root.id, actorId, 1, now);
    if ("error" in renewed) return { error: renewed.error };
    message = `Se renovó el plan de ${root.name} un mes.`;
  }

  // Solo se marca atendida si seguía pendiente (otra persona pudo atenderla a la vez).
  const done = await prisma.creditRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: "APPROVED", resolvedAt: now, resolvedById: actorId },
  });
  if (done.count === 0) return { error: "Esta solicitud ya fue atendida." };

  await audit({
    entityType: "CreditRequest",
    entityId: requestId,
    action: "credit_request_approved",
    userId: actorId,
    organizationId: request.organizationId,
    after: { kind: request.kind, credits: request.credits },
  });
  return { message };
}

export async function rejectRequest(requestId: string, actorId: string, note?: string | null, now = new Date()): Promise<{ error: string } | { ok: true }> {
  const resolvedNote = note?.trim().slice(0, 300) || null;
  const done = await prisma.creditRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: "REJECTED", resolvedAt: now, resolvedById: actorId, resolvedNote },
  });
  if (done.count === 0) return { error: "La solicitud no existe o ya fue atendida." };
  const request = await prisma.creditRequest.findUnique({ where: { id: requestId }, select: { organizationId: true, kind: true } });
  await audit({
    entityType: "CreditRequest",
    entityId: requestId,
    action: "credit_request_rejected",
    userId: actorId,
    organizationId: request?.organizationId ?? null,
    after: { kind: request?.kind, note: resolvedNote },
  });
  return { ok: true };
}
