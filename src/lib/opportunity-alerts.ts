import { isOpenStage, type Stage, type Priority } from "./pipeline";

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

interface AlertableRow {
  stage: Stage;
  priority: Priority | null;
  leadScore: number | null;
  nextAction: string;
  nextActionAt: string | null;
  expectedCloseDate: string | null;
  updatedAt: string;
}

export interface DerivedAlert {
  reasons: string[];
  severity: "alta" | "media" | null;
}

function daysSince(todayStr: string, iso: string): number {
  const date = new Date(iso.slice(0, 10) + "T00:00:00");
  const today = new Date(todayStr + "T00:00:00");
  return Math.round((today.getTime() - date.getTime()) / 86_400_000);
}

export function deriveAlerts(row: AlertableRow, todayStr: string): DerivedAlert {
  if (!isOpenStage(row.stage)) return { reasons: [], severity: null };

  const reasons: string[] = [];

  if (row.nextActionAt) {
    const overdueDays = daysSince(todayStr, row.nextActionAt);
    if (overdueDays > 0) reasons.push(`Próxima acción vencida hace ${overdueDays} día(s)`);
  }
  if (!row.nextAction || !row.nextActionAt) {
    reasons.push("Sin próxima acción cargada");
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

  if (reasons.length === 0) return { reasons, severity: null };
  const severity = row.priority === "ALTA" || reasons.length >= 3 ? "alta" : "media";
  return { reasons, severity };
}
