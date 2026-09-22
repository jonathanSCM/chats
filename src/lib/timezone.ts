// Conversión entre hora de pared de una zona horaria (ej. "9am en
// America/La_Paz") y el instante UTC real que le corresponde, sin depender
// de ninguna librería -- solo Intl, que ya trae Node.

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  weekday: number; // 0=domingo ... 6=sábado, mismo índice que Date#getDay()
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Los campos de fecha/hora que `date` representa, vistos desde `timeZone`. */
export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24, // hour12:false da "24" a medianoche en vez de "00"
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/**
 * El instante UTC real que corresponde a esa hora de pared en `timeZone`.
 * Un solo ajuste por diferencia de offset alcanza para el uso de acá
 * (agendar reuniones, no aritmética de calendario exacta en el instante de
 * un cambio de horario de verano).
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const seen = getZonedParts(guess, timeZone);
  const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(guess.getTime() + (wantedAsUtc - seenAsUtc));
}
