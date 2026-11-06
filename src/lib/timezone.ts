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
 * Se ajusta dos veces: el offset de la zona puede ser distinto en el instante
 * de partida y en el resultado cuando hay un cambio de horario de verano de por
 * medio (con un solo ajuste, una hora de pared pocas horas después del cambio
 * salía 1 hora corrida). Una hora que no existe (el "salto" de primavera) cae
 * en la hora válida siguiente.
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
  const first = new Date(guess.getTime() + (wantedAsUtc - seenAsUtc));

  const seen2 = getZonedParts(first, timeZone);
  const seen2AsUtc = Date.UTC(seen2.year, seen2.month - 1, seen2.day, seen2.hour, seen2.minute);
  return new Date(first.getTime() + (wantedAsUtc - seen2AsUtc));
}

/**
 * Cómo nombrarle una zona horaria a una persona: "Lima (GMT-5)". Para decirle en qué hora está expresado un horario
 * ("9:00, hora de Lima (GMT-5)") y que nadie lo lea en otra zona sin darse cuenta.
 */
export function zoneLabel(timeZone: string, at: Date = new Date()): string {
  const city = (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
  let offset = "";
  try {
    offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    /* zona desconocida: se deja solo el nombre */
  }
  return offset ? `${city} (${offset})` : city;
}
