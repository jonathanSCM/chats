import { prisma } from "@/server/db/client";
import { checkSeat, type SeatCounts, type SeatRole } from "@/lib/org-limits";

/** Cuentas que no ocupan un lugar del plan: el administrador de la plataforma y las técnicas. */
const NOT_A_SEAT = ["SUPERADMIN", "SYSTEM"] as const;

/** Administradores (OWNER) y vendedores (MEMBER) de la organización; opcionalmente cuenta también las invitaciones pendientes. */
export async function getSeatCounts(
  organizationId: string,
  options: { includePendingInvites?: boolean } = {},
): Promise<SeatCounts> {
  const [admins, sellers] = await Promise.all([
    prisma.organizationMembership.count({
      where: { organizationId, role: "OWNER", user: { role: { notIn: [...NOT_A_SEAT] } } },
    }),
    prisma.organizationMembership.count({
      where: { organizationId, role: "MEMBER", user: { role: { notIn: [...NOT_A_SEAT] } } },
    }),
  ]);
  if (!options.includePendingInvites) return { admins, sellers };

  const pending = await prisma.organizationInvite.groupBy({
    by: ["role"],
    where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
    _count: { _all: true },
  });
  const pendingOf = (role: SeatRole) => pending.find((p) => p.role === role)?._count._all ?? 0;
  return { admins: admins + pendingOf("OWNER"), sellers: sellers + pendingOf("MEMBER") };
}

/**
 * null si cabe una persona más con ese rol; si no, el mensaje para mostrar. Al invitar se cuentan
 * las invitaciones pendientes (para no prometer más lugares de los que hay); al aceptar, solo los
 * miembros reales.
 */
export async function seatBlockedMessage(
  organizationId: string,
  role: SeatRole,
  options: { includePendingInvites?: boolean } = {},
): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { maxAdmins: true, maxSellers: true },
  });
  if (!org) return null;
  const result = checkSeat(org, await getSeatCounts(organizationId, options), role);
  return result.ok ? null : result.message;
}
