import { prisma } from "@/server/db/client";
import { checkSeat, type SeatCounts, type SeatLimits, type SeatRole } from "@/lib/org-limits";
import { groupSeatCounts, needsNewSeat, type GroupMembership } from "@/lib/org-hierarchy";

/** Cuentas que no ocupan un lugar del plan: el administrador de la plataforma y las técnicas. */
const NOT_A_SEAT = ["SUPERADMIN", "SYSTEM"] as const;

/**
 * El grupo de una organización: la organización raíz (el padre, o ella misma si no tiene padre) y
 * todas sus suborganizaciones. Los topes de usuarios son los de la raíz y se comparten en el grupo.
 */
export async function getOrgGroup(organizationId: string): Promise<{
  rootId: string;
  groupIds: string[];
  limits: SeatLimits;
}> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, parentId: true } });
  const rootId = org?.parentId ?? organizationId;
  const [root, children] = await Promise.all([
    prisma.organization.findUnique({ where: { id: rootId }, select: { maxAdmins: true, maxSellers: true } }),
    prisma.organization.findMany({ where: { parentId: rootId }, select: { id: true } }),
  ]);
  return {
    rootId,
    groupIds: [rootId, ...children.map((c) => c.id)],
    limits: { maxAdmins: root?.maxAdmins ?? null, maxSellers: root?.maxSellers ?? null },
  };
}

async function groupMemberships(groupIds: string[]): Promise<GroupMembership[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: { organizationId: { in: groupIds }, user: { role: { notIn: [...NOT_A_SEAT] } } },
    select: { userId: true, role: true },
  });
  return rows.map((r) => ({ userId: r.userId, role: r.role === "OWNER" ? "OWNER" : "MEMBER" }));
}

async function pendingInvites(groupIds: string[]): Promise<SeatCounts> {
  const pending = await prisma.organizationInvite.groupBy({
    by: ["role"],
    where: { organizationId: { in: groupIds }, acceptedAt: null, expiresAt: { gt: new Date() } },
    _count: { _all: true },
  });
  const of = (role: SeatRole) => pending.find((p) => p.role === role)?._count._all ?? 0;
  return { admins: of("OWNER"), sellers: of("MEMBER") };
}

/** Administradores y vendedores del GRUPO (personas distintas); opcionalmente suma las invitaciones pendientes. */
export async function getSeatCounts(
  organizationId: string,
  options: { includePendingInvites?: boolean } = {},
): Promise<SeatCounts> {
  const { groupIds } = await getOrgGroup(organizationId);
  const counts = groupSeatCounts(await groupMemberships(groupIds));
  if (!options.includePendingInvites) return counts;
  const pending = await pendingInvites(groupIds);
  return { admins: counts.admins + pending.admins, sellers: counts.sellers + pending.sellers };
}

/** Topes del grupo y uso actual, para mostrar "2 de 5". */
export async function getSeatPlan(organizationId: string): Promise<{ limits: SeatLimits; counts: SeatCounts; isGroup: boolean }> {
  const { groupIds, limits } = await getOrgGroup(organizationId);
  return { limits, counts: groupSeatCounts(await groupMemberships(groupIds)), isGroup: groupIds.length > 1 };
}

/**
 * null si se puede sumar a alguien con ese rol; si no, el mensaje para mostrar.
 *  - `userId`: si esa persona ya ocupa un lugar en el grupo (por ejemplo, una vendedora del padre a la
 *    que se asigna a una hija) no se cuenta de nuevo.
 *  - `includePendingInvites`: al invitar se cuentan las invitaciones pendientes.
 */
export async function seatBlockedMessage(
  organizationId: string,
  role: SeatRole,
  options: { includePendingInvites?: boolean; userId?: string } = {},
): Promise<string | null> {
  const { groupIds, limits } = await getOrgGroup(organizationId);
  const rows = await groupMemberships(groupIds);
  if (options.userId && !needsNewSeat(rows, options.userId, role)) return null;

  const counts = groupSeatCounts(rows);
  if (options.includePendingInvites) {
    const pending = await pendingInvites(groupIds);
    counts.admins += pending.admins;
    counts.sellers += pending.sellers;
  }
  const result = checkSeat(limits, counts, role);
  return result.ok ? null : result.message;
}
