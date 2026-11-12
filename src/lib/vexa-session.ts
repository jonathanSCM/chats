/**
 * El bot de reuniones (Vexa) crea una SESIÓN por cada vez que entra a una sala, con un id interno propio.
 * Antes el CRM seguía al bot por el código de la sala de Meet, así que una sala reutilizada (o dos
 * organizaciones en la misma sala) podían confundirse. Ahora se guarda el id de la sesión al pedir el bot y
 * todo lo demás (estado, transcripción, grabación) se busca por ese id.
 */

import { SHOT_REASONS } from "./bot-shot";

export const NON_TERMINAL_STATUSES = new Set(["requested", "joining", "awaiting_admission", "active"]);

export interface VexaSessionEntry {
  id: number;
  status: string;
  native_meeting_id: string;
  platform: string;
  created_at?: string | null;
  updated_at?: string | null;
  failure_stage?: string | null;
  completion_reason?: string | null;
  /** Detalle que guarda Vexa de la sesión; `join_evidence.reason` dice por qué no se pudo entrar. */
  data?: { join_evidence?: { reason?: string | null; detail?: string | null } | null } | null;
}

/** Motivo técnico del fallo al entrar (`awaiting_admission_timeout`, `never_reached_lobby`…), si Vexa lo informó. */
export function joinFailureCode(entry: Pick<VexaSessionEntry, "data" | "failure_stage">): string | null {
  return entry.data?.join_evidence?.reason ?? null;
}

/** El motivo del fallo en palabras de una persona, para mostrarlo en el CRM. */
export function describeJoinFailure(entry: Pick<VexaSessionEntry, "data" | "failure_stage" | "completion_reason">): string {
  switch (joinFailureCode(entry)) {
    case "awaiting_admission_timeout":
      return "Nadie admitió al asistente en la sala de espera (esperó 15 minutos). Quien organiza la reunión tiene que aceptarlo cuando aparezca el aviso de Meet.";
    case "awaiting_admission_rejected":
      // El parche de ProShop (vexa-patches/apply-guest-blocked.js) deja en el detalle que Meet mostró "You can't join this
      // video call": no lo rechazó una persona, Meet bloqueó al invitado anónimo.
      if (isGoogleGuestBlock(entry)) return SHOT_REASONS.blocked;
      return "Quien organiza la reunión rechazó al asistente.";
    case "never_reached_lobby":
      return "Meet no dejó que el asistente llegara a la sala (rechazó su arranque, el link no abrió una reunión activa, o lo bloqueó). El CRM ya lo reintentó varias veces.";
    case "stopped_while_joining":
      return "Se canceló antes de que el asistente llegara a entrar.";
    default:
      return "El asistente no pudo entrar a la reunión.";
  }
}

/** Meet mostró «You can't join this video call» al pedir entrar: lo decidió Google, no una persona. */
export function isGoogleGuestBlock(entry: Pick<VexaSessionEntry, "data">): boolean {
  return /video call/i.test(entry.data?.join_evidence?.detail ?? "");
}

/**
 * Reintentos de entrada tras un rechazo de Google. Medido el 12-nov-2026 en el servidor: Meet rechaza al asistente al azar
 * (403 al arrancar, o «You can't join this video call» al pedir entrar) y la misma sala entra bien a los pocos minutos; en
 * una prueba pasó al 3.er intento seguido. Por eso se insiste unas veces antes de dar la reunión por perdida.
 */
export const MAX_JOIN_RETRIES = 3;

/** Espera antes del reintento número `attempt + 1`: corta al principio (suele bastar) y más larga después. */
export function joinRetryDelayMs(attempt: number): number {
  return [15_000, 45_000, 90_000][Math.min(Math.max(attempt, 0), 2)];
}

/** Motivos que anotan las capturas cuando Meet mandó al asistente a su página de inicio: suelen ser pasajeros (ver arriba). */
export function isTransientShotReason(reason: string | null): boolean {
  return reason === SHOT_REASONS.inactive || reason === SHOT_REASONS.blocked;
}

/**
 * ¿Vale la pena pedir el asistente de nuevo? Solo si el fallo suele ser pasajero:
 *  - `never_reached_lobby`: Meet no mostró la sala (rechazó el arranque; a veces se arregla al segundo intento).
 *  - Bloqueo automático de Google («You can't join this video call»), que no es una decisión del anfitrión.
 *  - `awaiting_admission_timeout` en una reunión agendada que todavía no terminó: el anfitrión suele llegar tarde.
 * Nunca después de un rechazo del anfitrión ni de una cancelación a mano, y con tope de reintentos.
 */
export function shouldRetryJoin(params: {
  entry: Pick<VexaSessionEntry, "data" | "failure_stage">;
  attempt: number;
  scheduledInAdvance: boolean;
  meetingEnded: boolean;
}): boolean {
  if (params.attempt >= MAX_JOIN_RETRIES || params.meetingEnded) return false;
  const code = joinFailureCode(params.entry);
  if (code === "never_reached_lobby") return true;
  // Un rechazo de una PERSONA (anfitrión) nunca se reintenta; el bloqueo automático de Google sí.
  if (code === "awaiting_admission_rejected") return isGoogleGuestBlock(params.entry);
  return code === "awaiting_admission_timeout" && params.scheduledInAdvance;
}

/** El id de la sesión que devuelve Vexa al crear el bot (según la versión viene como `id` o dentro de `meeting`). */
export function parseSessionId(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { id?: unknown; meeting_id?: unknown; meeting?: { id?: unknown } };
  for (const candidate of [b.id, b.meeting_id, b.meeting?.id]) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) return candidate;
  }
  return null;
}

const time = (value: string | null | undefined) => (value ? new Date(value).getTime() || 0 : 0);

/**
 * La sesión de la lista de Vexa que corresponde a esta reunión.
 *  - Con `sessionId`: solo esa, exacta. Si no está (todavía), null: no se "adivina" otra de la misma sala.
 *  - Sin `sessionId` (reuniones iniciadas antes de este cambio): la más nueva de esa sala creada a partir de
 *    `sinceMs` (cuando el CRM pidió el bot).
 */
export function pickSession(
  list: VexaSessionEntry[],
  target: { sessionId: number | null; nativeId: string; sinceMs: number },
): VexaSessionEntry | null {
  if (target.sessionId !== null) return list.find((e) => e.id === target.sessionId) ?? null;
  return (
    list
      .filter((e) => e.platform === "google_meet" && e.native_meeting_id === target.nativeId && time(e.created_at) >= target.sinceMs)
      .sort((a, b) => time(b.created_at) - time(a.created_at))[0] ?? null
  );
}

export type ConflictDecision =
  | { action: "adopt"; sessionId: number }
  /** Vexa dice que ya hay un bot en la sala pero no se ve en la lista: se reintenta más tarde. */
  | { action: "retry" }
  /** La sesión que ocupa la sala no es de esta organización: no se la adopta (no se copia nada ajeno). */
  | { action: "refuse" };

/**
 * Vexa respondió 409 ("ya hay un bot en esa sala"). Solo se adopta la sesión si es de ESTA organización:
 * la propia reunión ya la tenía, o otra reunión de la misma organización la inició. Si la inició otra
 * organización (o no se sabe de quién es), no se toca.
 */
export function decideConflict(params: {
  list: VexaSessionEntry[];
  nativeId: string;
  ownSessionId: number | null;
  sameOrgSessionIds: Set<number>;
}): ConflictDecision {
  const active = params.list
    .filter((e) => e.platform === "google_meet" && e.native_meeting_id === params.nativeId && NON_TERMINAL_STATUSES.has(e.status))
    .sort((a, b) => time(b.created_at) - time(a.created_at))[0];
  if (!active) return { action: "retry" };
  if (params.ownSessionId === active.id || params.sameOrgSessionIds.has(active.id)) {
    return { action: "adopt", sessionId: active.id };
  }
  return { action: "refuse" };
}
