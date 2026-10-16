/**
 * F13 — funciones puras del análisis de aprendizaje (sin base de datos,
 * para poder probarlas). La ruta /api/dashboard/learning las alimenta.
 */

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Clave para agrupar objeciones parecidas: minúsculas, sin tildes ni signos. */
export function objectionKey(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export type Outcome = "won" | "lost" | "open";

export interface ObjectionStat {
  text: string;
  count: number;
  won: number;
  lost: number;
  open: number;
}

/** Cuenta cada objeción una vez por oportunidad y la cruza con su resultado. */
export function aggregateObjections(
  items: { texts: string[]; outcome: Outcome }[],
  limit = 10,
): ObjectionStat[] {
  const map = new Map<string, ObjectionStat>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const raw of item.texts) {
      const key = objectionKey(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = map.get(key) ?? { text: raw.trim(), count: 0, won: 0, lost: 0, open: 0 };
      entry.count += 1;
      entry[item.outcome] += 1;
      map.set(key, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export interface StageEvent {
  opportunityId: string;
  stageId: string;
  at: Date;
}

/**
 * Días que cada oportunidad estuvo en cada etapa, a partir de la secuencia de
 * cambios. La etapa actual (último evento) cuenta hasta `now` solo si sigue
 * abierta (`openIds`); si ya cerró, no se mide (no hay "siguiente" evento).
 */
export function stageDwellDays(
  events: StageEvent[],
  openIds: Set<string>,
  now: Date,
): Map<string, number[]> {
  const byOpp = new Map<string, StageEvent[]>();
  for (const e of events) {
    const list = byOpp.get(e.opportunityId) ?? [];
    list.push(e);
    byOpp.set(e.opportunityId, list);
  }
  const result = new Map<string, number[]>();
  const push = (stageId: string, days: number) => {
    const list = result.get(stageId) ?? [];
    list.push(days);
    result.set(stageId, list);
  };
  for (const [oppId, list] of byOpp) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let i = 0; i < list.length; i++) {
      const start = list[i].at.getTime();
      const next = list[i + 1];
      if (next) push(list[i].stageId, Math.max(0, (next.at.getTime() - start) / 86_400_000));
      else if (openIds.has(oppId)) push(list[i].stageId, Math.max(0, (now.getTime() - start) / 86_400_000));
    }
  }
  return result;
}

export interface MessageLite {
  conversationId: string;
  role: "CUSTOMER" | "BOT" | "STAFF" | "SYSTEM";
  createdAt: Date;
}

/**
 * Minutos hasta la primera respuesta humana (STAFF) tras el primer mensaje
 * del cliente de cada conversación. Espera los mensajes ordenados por fecha.
 */
export function firstResponseMinutes(messages: MessageLite[]): number[] {
  const firstCustomer = new Map<string, Date>();
  const done = new Set<string>();
  const out: number[] = [];
  for (const m of messages) {
    if (done.has(m.conversationId)) continue;
    if (m.role === "CUSTOMER") {
      if (!firstCustomer.has(m.conversationId)) firstCustomer.set(m.conversationId, m.createdAt);
    } else if (m.role === "STAFF") {
      const start = firstCustomer.get(m.conversationId);
      if (start) {
        out.push((m.createdAt.getTime() - start.getTime()) / 60_000);
        done.add(m.conversationId);
      }
    }
  }
  return out;
}
