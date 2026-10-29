/**
 * El bot de reuniones (Vexa) crea una SESIÓN por cada vez que entra a una sala, con un id interno propio.
 * Antes el CRM seguía al bot por el código de la sala de Meet, así que una sala reutilizada (o dos
 * organizaciones en la misma sala) podían confundirse. Ahora se guarda el id de la sesión al pedir el bot y
 * todo lo demás (estado, transcripción, grabación) se busca por ese id.
 */

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
