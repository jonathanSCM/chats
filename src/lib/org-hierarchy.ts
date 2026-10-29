import type { SeatCounts, SeatRole } from "@/lib/org-limits";

/**
 * Una organización "padre" y sus suborganizaciones forman un GRUPO que comparte el plan de
 * usuarios: los topes de administradores y vendedores son los del padre y cuentan personas
 * distintas, no membresías. Una persona que está en el padre y en dos hijas ocupa un solo lugar.
 */

export interface GroupMembership {
  userId: string;
  role: SeatRole;
}

/** El lugar que ocupa cada persona en el grupo: administrador si lo es en alguna organización, si no vendedor. */
export function seatRoleByUser(rows: GroupMembership[]): Map<string, SeatRole> {
  const seat = new Map<string, SeatRole>();
  for (const { userId, role } of rows) {
    if (role === "OWNER" || !seat.has(userId)) seat.set(userId, role);
  }
  return seat;
}

export function groupSeatCounts(rows: GroupMembership[]): SeatCounts {
  let admins = 0;
  let sellers = 0;
  for (const role of seatRoleByUser(rows).values()) {
    if (role === "OWNER") admins++;
    else sellers++;
  }
  return { admins, sellers };
}

/**
 * ¿Meter a esta persona con este rol ocupa un lugar NUEVO de ese rol?
 *  - Ya es administrador del grupo: no ocupa nada más, sea cual sea el rol que se le dé.
 *  - Ya es vendedor y se le da rol de vendedor: nada nuevo.
 *  - Ya es vendedor y pasa a administrador: ocupa un lugar de administrador (libera uno de vendedor).
 *  - No está en el grupo: ocupa un lugar del rol que se le da.
 */
export function needsNewSeat(rows: GroupMembership[], userId: string, role: SeatRole): boolean {
  const current = seatRoleByUser(rows).get(userId);
  if (current === "OWNER") return false;
  if (current === "MEMBER") return role === "OWNER";
  return true;
}

/**
 * Marca efectiva de una organización: la propia si su plan la permite y tiene algo cargado; si no,
 * la de su organización padre (si la hay y a ella sí se lo permite su plan).
 */
export function pickBrandSource<T extends { custom: boolean }>(own: T, parent: T | null): T {
  if (own.custom) return own;
  return parent?.custom ? parent : own;
}
