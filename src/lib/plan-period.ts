/**
 * Vigencia de un plan: desde cuándo corre, hasta cuándo está activo y qué pasa al vencer.
 * Con fecha de vencimiento: aviso 7 días antes, 5 días de gracia después (la IA sigue) y luego la IA se detiene.
 * Sin fecha (organización "a medida"): no vence nunca.
 */

export const GRACE_DAYS = 5;
export const WARN_DAYS = 7;

const DAY_MS = 86_400_000;

/** Suma meses de calendario en UTC; si el día no existe en el mes destino (31 → feb) queda el último día del mes. */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export interface CreditPeriod {
  start: Date;
  /** Cuándo se renueva la bolsa mensual (inicio del período siguiente). */
  end: Date;
}

/**
 * Período vigente de la bolsa mensual de créditos. Con un plan que empezó en `anchor`, la bolsa se renueva cada mes
 * ese mismo día (aunque el plan dure varios meses). Sin ancla, el mes calendario en UTC de siempre.
 */
export function creditPeriod(anchor: Date | null, now: Date): CreditPeriod {
  if (!anchor || anchor.getTime() > now.getTime()) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
  }
  // Meses enteros transcurridos desde el ancla (una estimación y se corrige).
  let k = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  let start = addMonths(anchor, k);
  while (start.getTime() > now.getTime()) {
    k -= 1;
    start = addMonths(anchor, k);
  }
  while (addMonths(anchor, k + 1).getTime() <= now.getTime()) {
    k += 1;
    start = addMonths(anchor, k);
  }
  return { start, end: addMonths(anchor, k + 1) };
}

export type PlanState = "none" | "active" | "expiring" | "grace" | "expired";

export interface PlanStatus {
  state: PlanState;
  /** Días que faltan para vencer (negativo si ya venció); null sin fecha. */
  daysLeft: number | null;
  /** Hasta cuándo dura la gracia (solo si ya venció). */
  graceEndsAt: Date | null;
  /** ¿La IA y el asistente de reuniones están detenidos por el vencimiento? */
  aiBlocked: boolean;
}

/** Estado del plan según su fecha de vencimiento. */
export function planStatus(endsAt: Date | null, now: Date, opts: { graceDays?: number; warnDays?: number } = {}): PlanStatus {
  if (!endsAt) return { state: "none", daysLeft: null, graceEndsAt: null, aiBlocked: false };
  const grace = opts.graceDays ?? GRACE_DAYS;
  const warn = opts.warnDays ?? WARN_DAYS;
  const msLeft = endsAt.getTime() - now.getTime();
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  if (msLeft > warn * DAY_MS) return { state: "active", daysLeft, graceEndsAt: null, aiBlocked: false };
  if (msLeft > 0) return { state: "expiring", daysLeft, graceEndsAt: null, aiBlocked: false };
  const graceEndsAt = new Date(endsAt.getTime() + grace * DAY_MS);
  if (now.getTime() < graceEndsAt.getTime()) return { state: "grace", daysLeft, graceEndsAt, aiBlocked: false };
  return { state: "expired", daysLeft, graceEndsAt, aiBlocked: true };
}

/** Texto del aviso para el dueño; null si el plan está bien. */
export function planStatusNotice(status: PlanStatus, endsAtLabel: string): string | null {
  switch (status.state) {
    case "expiring": {
      const d = status.daysLeft ?? 0;
      return `Tu plan vence el ${endsAtLabel} (${d <= 1 ? "queda 1 día" : `quedan ${d} días`}). Pide la renovación para no quedarte sin IA.`;
    }
    case "grace":
      return `Tu plan venció el ${endsAtLabel}. Tienes unos días de gracia en los que todo sigue funcionando; después se detendrá la IA (el CRM seguirá funcionando). Pide la renovación.`;
    case "expired":
      return `Tu plan venció el ${endsAtLabel}. La IA y el asistente de reuniones están detenidos hasta que se renueve; el resto del CRM sigue funcionando.`;
    default:
      return null;
  }
}

export const PLAN_STATE_LABEL: Record<PlanState, string> = {
  none: "Sin vencimiento",
  active: "Activo",
  expiring: "Por vencer",
  grace: "Vencido (en gracia)",
  expired: "Vencido",
};
