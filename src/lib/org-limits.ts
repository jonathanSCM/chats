/** Rol dentro de una organización: OWNER = administrador, MEMBER = vendedor. */
export type SeatRole = "OWNER" | "MEMBER";

export interface SeatLimits {
  maxAdmins: number | null;
  maxSellers: number | null;
}

export interface SeatCounts {
  admins: number;
  sellers: number;
}

const LABEL: Record<SeatRole, { singular: string; plural: string }> = {
  OWNER: { singular: "administrador", plural: "administradores" },
  MEMBER: { singular: "vendedor", plural: "vendedores" },
};

export function seatLimitFor(limits: SeatLimits, role: SeatRole): number | null {
  return role === "OWNER" ? limits.maxAdmins : limits.maxSellers;
}

export function seatUsedFor(counts: SeatCounts, role: SeatRole): number {
  return role === "OWNER" ? counts.admins : counts.sellers;
}

/**
 * ¿Cabe una persona más con este rol? `counts` ya debe incluir a quien ocupa lugar (miembros y,
 * al invitar, invitaciones pendientes). Sin tope (null) siempre cabe.
 */
export function checkSeat(
  limits: SeatLimits,
  counts: SeatCounts,
  role: SeatRole,
): { ok: true } | { ok: false; message: string } {
  const limit = seatLimitFor(limits, role);
  if (limit === null) return { ok: true };
  const used = seatUsedFor(counts, role);
  if (used < limit) return { ok: true };
  const { singular, plural } = LABEL[role];
  return {
    ok: false,
    message: `Tu plan permite ${limit} ${limit === 1 ? singular : plural} y ya tienes ${used}. Pídele al administrador de la plataforma que amplíe el límite.`,
  };
}

/** "2 de 5" / "2 (sin límite)" para mostrar el uso del plan. */
export function formatSeatUsage(used: number, limit: number | null): string {
  return limit === null ? `${used} (sin límite)` : `${used} de ${limit}`;
}
