/**
 * Ventana de fechas que se le pide a Meta en la sincronización de gasto.
 *
 * Antes se pedía `date_preset=last_7d`, que son los 7 días YA TERMINADOS y no
 * incluye el día en curso: una campaña creada hoy (o el gasto de hoy) no
 * aparecía hasta mañana. Ahora se pide un rango explícito que termina HOY,
 * medido en la zona horaria de la cuenta publicitaria (es la que usa Meta para
 * decidir qué es "hoy").
 */

const DEFAULT_TIMEZONE = "America/La_Paz";

/** Días hacia atrás (además de hoy) que cubre cada ventana con nombre. */
const PRESET_DAYS: Record<string, number> = {
  last_7d: 7,
  last_30d: 30,
  last_90d: 90,
  last_year: 365,
};

/** Fecha de hoy ("2026-10-23") en la zona horaria dada; si la zona es inválida, usa la de Bolivia. */
export function todayInZone(timeZone: string | null | undefined, now: Date = new Date()): string {
  const zones = [timeZone, DEFAULT_TIMEZONE].filter((z): z is string => Boolean(z));
  for (const zone of zones) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    } catch {
      // zona desconocida: se prueba la siguiente
    }
  }
  return now.toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Rango { since, until } que termina hoy. `preset` es la ventana con nombre
 * ("last_7d"...); sin ella: 7 días si ya hay historia y 90 si es la primera vez.
 */
export function adInsightsRange(
  preset: string | undefined,
  hasHistory: boolean,
  timeZone: string | null | undefined,
  now: Date = new Date(),
): { since: string; until: string } {
  const days = (preset && PRESET_DAYS[preset]) || (hasHistory ? 7 : 90);
  const until = todayInZone(timeZone, now);
  return { since: shiftDays(until, -days), until };
}
