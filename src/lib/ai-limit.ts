/**
 * Tope mensual de IA de una organización con clave personalizada (modo "custom"): un tope de gasto
 * en USD y/o un tope de tokens por mes. Vacío (null) = sin ese tope. El mes es el calendario en UTC.
 */

export interface MonthlyLimits {
  budgetUsd: number | null;
  tokens: number | null;
}

export interface MonthlyUsage {
  costUsd: number;
  tokens: number;
}

/** Primer instante del mes (UTC) en el que cae `now`. */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Primer instante del mes siguiente (UTC): cuando se reanuda la IA si se agotó el tope. */
export function nextMonthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function money(n: number): string {
  return `USD ${n.toFixed(2)}`;
}

function count(n: number): string {
  return n.toLocaleString("es");
}

export type LimitStatus = { ok: true } | { ok: false; reason: "budget" | "tokens"; message: string };

/** ¿Ya se llegó a algún tope del mes? Con el gasto o los tokens iguales al tope, la IA se detiene. */
export function checkMonthlyLimit(limits: MonthlyLimits, usage: MonthlyUsage): LimitStatus {
  if (limits.budgetUsd !== null && usage.costUsd >= limits.budgetUsd) {
    return {
      ok: false,
      reason: "budget",
      message: `Se alcanzó el límite mensual de IA de tu plan (${money(limits.budgetUsd)}). La IA se reanuda el mes que viene o cuando se amplíe el límite.`,
    };
  }
  if (limits.tokens !== null && usage.tokens >= limits.tokens) {
    return {
      ok: false,
      reason: "tokens",
      message: `Se alcanzó el límite mensual de IA de tu plan (${count(limits.tokens)} tokens). La IA se reanuda el mes que viene o cuando se amplíe el límite.`,
    };
  }
  return { ok: true };
}

/** Texto corto del uso para el panel: "USD 3.20 de USD 10.00 · 120 de 500 tokens". */
export function describeMonthlyUsage(limits: MonthlyLimits, usage: MonthlyUsage): string {
  const spend =
    limits.budgetUsd === null ? `${money(usage.costUsd)} (sin tope de gasto)` : `${money(usage.costUsd)} de ${money(limits.budgetUsd)}`;
  const tokens =
    limits.tokens === null ? `${count(usage.tokens)} tokens (sin tope)` : `${count(usage.tokens)} de ${count(limits.tokens)} tokens`;
  return `${spend} · ${tokens}`;
}
