import { hasCompleteNextAction, type Priority } from "./pipeline";
import type { PipelineStageRole } from "@/generated/prisma/enums";

/**
 * Alertas derivadas sin gastar presupuesto de IA (punto 14 del scope de
 * Seguimiento Comercial): consolidan en un solo lugar señales que hoy
 * están sueltas en distintos indicadores (vencido, sin próxima acción)
 * más señales nuevas (estancamiento, cierre esperado vencido, lead
 * caliente que se enfría). No reemplazan esos indicadores — los juntan
 * para saber de un vistazo si a una oportunidad hay que prestarle
 * atención.
 *
 * `needStatus`/`budgetStatus` (los campos que nombraba el plan original)
 * quedaron afuera a propósito: en la práctica casi nunca se completan
 * (`needStatus` solo lo setea el bot de calificación una vez,
 * `budgetStatus` nunca), así que hoy son casi todo "UNKNOWN" y marcarían
 * prácticamente cualquier oportunidad — no son una señal útil todavía.
 */

const STALE_DAYS = 14;
const HOT_LEAD_STALE_DAYS = 7;
const HOT_LEAD_SCORE = 70;
// F13: umbrales de las alertas de coach.
const HIGH_CLOSE_PROBABILITY = 70;
const PROPOSAL_NO_REPLY_DAYS = 5;
const MEETING_NO_FOLLOWUP_DAYS = 3;

interface AlertableRow {
  // Antes `Stage` (union fija); ahora basta con el rol resuelto de la
  // PipelineStage de la organización (null = etapa intermedia abierta).
  stage: { role: PipelineStageRole | null };
  priority: Priority | null;
  leadScore: number | null;
  nextAction: string;
  nextActionAt: string | null;
  expectedCloseDate: string | null;
  updatedAt: string;
  assignedTo: unknown;
  // F13 (opcionales: los callers que no los tengan siguen funcionando).
  probability?: number | null;
  proposalSentAt?: string | null;
  authorityLevel?: string | null;
  /** Fecha de la última reunión realizada (status DONE). */
  lastMeetingAt?: string | null;
}

export interface DerivedAlert {
  reasons: string[];
  severity: "alta" | "media" | null;
  /** Señales positivas (p. ej. alta probabilidad de cierre): no suben la severidad. */
  highlights: string[];
}

function daysSince(todayStr: string, iso: string): number {
  const date = new Date(iso.slice(0, 10) + "T00:00:00");
  const today = new Date(todayStr + "T00:00:00");
  return Math.round((today.getTime() - date.getTime()) / 86_400_000);
}

/**
 * "Ordenar por: Más urgente" (scope §8, y también usado para subir los
 * vencidos arriba dentro de cada columna del Kanban, §9): tupla
 * comparada posición por posición — vencidas primero, después hoy,
 * después alta prioridad, después mayor calidad, y por último la fecha
 * de próxima acción más cercana (sin fecha, al final).
 */
export function urgencyRank(
  row: { nextActionAt: string | null; priority: Priority | null; leadScore: number | null },
  todayStr: string,
): number[] {
  const d = row.nextActionAt?.slice(0, 10) ?? null;
  const overdue = d && d < todayStr ? 0 : 1;
  const isToday = d === todayStr ? 0 : 1;
  const highPriority = row.priority === "ALTA" ? 0 : 1;
  const quality = -(row.leadScore ?? -1);
  const dateRank = d ? new Date(d).getTime() : Number.MAX_SAFE_INTEGER;
  return [overdue, isToday, highPriority, quality, dateRank];
}

export function deriveAlerts(row: AlertableRow, todayStr: string): DerivedAlert {
  if (row.stage.role !== null) return { reasons: [], severity: null, highlights: [] };

  const reasons: string[] = [];
  const highlights: string[] = [];

  if (row.nextActionAt) {
    const overdueDays = daysSince(todayStr, row.nextActionAt);
    if (overdueDays > 0) reasons.push(`Próxima acción vencida hace ${overdueDays} día(s)`);
  }
  if (!hasCompleteNextAction(row)) {
    reasons.push(
      row.nextAction && row.nextActionAt ? "Sin responsable asignado" : "Sin próxima acción cargada",
    );
  }
  if (row.expectedCloseDate && daysSince(todayStr, row.expectedCloseDate) > 0) {
    reasons.push("La fecha esperada de cierre ya pasó");
  }

  const staleDays = daysSince(todayStr, row.updatedAt);
  if (staleDays >= STALE_DAYS) {
    reasons.push(`Sin cambios hace ${staleDays} días`);
  }
  if ((row.leadScore ?? 0) >= HOT_LEAD_SCORE && staleDays >= HOT_LEAD_STALE_DAYS) {
    reasons.push("Lead de alta calidad sin avance reciente");
  }

  // ── F13: alertas de coach ─────────────────────────────────────────────
  if (row.proposalSentAt) {
    const days = daysSince(todayStr, row.proposalSentAt);
    if (days >= PROPOSAL_NO_REPLY_DAYS && row.updatedAt.slice(0, 10) <= row.proposalSentAt.slice(0, 10)) {
      reasons.push(`Propuesta enviada hace ${days} días sin respuesta`);
    }
  }
  if (row.lastMeetingAt) {
    const days = daysSince(todayStr, row.lastMeetingAt);
    if (days >= MEETING_NO_FOLLOWUP_DAYS && row.updatedAt.slice(0, 10) <= row.lastMeetingAt.slice(0, 10)) {
      reasons.push(`Reunión sin seguimiento hace ${days} días`);
    }
  }
  if ((row.proposalSentAt || row.lastMeetingAt) && !row.authorityLevel?.trim()) {
    reasons.push("Falta identificar al decisor");
  }
  if ((row.probability ?? 0) >= HIGH_CLOSE_PROBABILITY) {
    highlights.push(`Alta probabilidad de cierre (${row.probability}%): priorizar`);
  }

  if (reasons.length === 0) return { reasons, severity: null, highlights };
  const severity = row.priority === "ALTA" || reasons.length >= 3 ? "alta" : "media";
  return { reasons, severity, highlights };
}
