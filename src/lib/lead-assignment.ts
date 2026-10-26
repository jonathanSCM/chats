/**
 * Lógica pura de la asignación automática de leads (F14): quién sigue en el
 * reparto por turnos y cuándo corresponde avisar o reasignar por falta de
 * respuesta. Sin base de datos, para poder probarla.
 */

export interface Candidate {
  userId: string;
  /** Trabajo que ya tiene: oportunidades abiertas + chats activos suyos (ver el servicio). */
  load: number;
}

/**
 * Reparto equilibrado: gana quien tenga MENOS carga; si varios empatan, el que sigue por turnos
 * después del último que recibió (en un orden estable). Se saltea a quien llegó al tope
 * (`maxLoad`, null = sin tope). `excludeUserIds` sirve para reasignar sin devolver el lead a
 * quien no respondió. Si nadie puede recibir, null.
 */
export function chooseNextAssignee(
  candidates: Candidate[],
  lastUserId: string | null,
  maxLoad: number | null,
  excludeUserIds: string[] = [],
): string | null {
  const ordered = [...candidates].sort((a, b) => a.userId.localeCompare(b.userId));
  const eligible = ordered.filter(
    (c) => !excludeUserIds.includes(c.userId) && (maxLoad === null || c.load < maxLoad),
  );
  if (eligible.length === 0) return null;

  const minLoad = Math.min(...eligible.map((c) => c.load));
  const tied = new Set(eligible.filter((c) => c.load === minLoad).map((c) => c.userId));

  const start = lastUserId ? ordered.findIndex((c) => c.userId === lastUserId) + 1 : 0;
  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[(start + i) % ordered.length];
    if (tied.has(c.userId)) return c.userId;
  }
  return null;
}

export type SlaAction = "none" | "alert" | "reassign";

export interface SlaState {
  /** Desde cuándo espera el cliente (su último mensaje sin respuesta humana). */
  waitingSince: Date;
  now: Date;
  slaMinutes: number;
  alertedAt: Date | null;
  reassignedAt: Date | null;
  /** Solo lo asignado por el sistema se reasigna solo; lo asignado a mano no. */
  autoAssigned: boolean;
}

/**
 * - A los `slaMinutes` sin respuesta: avisar (una vez por espera).
 * - Al doble: reasignar al siguiente (una sola vez por lead), solo si lo asignó el sistema.
 */
export function slaAction(s: SlaState): SlaAction {
  const waitedMin = (s.now.getTime() - s.waitingSince.getTime()) / 60_000;
  if (waitedMin >= s.slaMinutes * 2 && s.autoAssigned && !s.reassignedAt) return "reassign";
  if (waitedMin >= s.slaMinutes && (!s.alertedAt || s.alertedAt < s.waitingSince)) return "alert";
  return "none";
}
