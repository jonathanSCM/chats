/**
 * Créditos de IA de CRM ProShop. 1 crédito = hasta US$0,001 de presupuesto de IA: es una unidad comercial
 * y de control, no el costo exacto de cada llamada. Cada organización tiene una bolsa mensual compartida
 * por todos sus usuarios (no se acumula) más paquetes comprados que duran 90 días.
 */

/** Dólares de presupuesto de IA que representa un crédito. */
export const CREDIT_USD = 0.001;

/** Créditos mensuales por usuario con los que se dimensiona el plan (5 usuarios = 8.000). Solo orientativo. */
export const CREDITS_PER_USER = 1_600;

/** Cuántos días dura un paquete comprado. */
export const PACK_VALID_DAYS = 90;

/** Créditos de emergencia: pasado el 100%, el bot que contesta a los clientes sigue unos créditos más antes del corte total. */
export const EMERGENCY_RESERVE = 300;

/** Créditos por minuto de transcripción de una reunión. */
export const CREDITS_PER_AUDIO_MINUTE = 5;

/** Paquetes que se venden (la recarga la carga el superadmin a mano). */
export const CREDIT_PACKS = [
  { credits: 2_000, priceSoles: 25 },
  { credits: 5_000, priceSoles: 50 },
  { credits: 10_000, priceSoles: 90 },
] as const;

/** Funciones que gastan créditos y cuánto cuesta cada una. */
export const FEATURE_CREDITS: Record<string, { label: string; credits: number }> = {
  bot_calificacion: { label: "Respuesta y calificación del bot", credits: 2 },
  seguimiento: { label: "Análisis comercial de un seguimiento", credits: 3 },
  knowledge_editor: { label: "Editor de conocimiento", credits: 3 },
  transcripcion: { label: "Transcripción de reunión", credits: CREDITS_PER_AUDIO_MINUTE },
};

/** Funciones automáticas (contestan a un cliente sin que nadie las pida): son las que usan la reserva de emergencia. */
export const AUTOMATIC_FEATURES: ReadonlySet<string> = new Set(["bot_calificacion", "transcripcion"]);

/** Una función que no está en la tabla cuesta 1 crédito, para que nada de IA salga gratis. */
export const DEFAULT_FEATURE_CREDITS = 1;

export function featureLabel(feature: string): string {
  return FEATURE_CREDITS[feature]?.label ?? feature;
}

/** Créditos de una llamada a la IA según su función. */
export function creditsForFeature(feature: string): number {
  return FEATURE_CREDITS[feature]?.credits ?? DEFAULT_FEATURE_CREDITS;
}

/** Minutos que se cobran de una reunión: se redondea hacia arriba y toda reunión con audio cuenta al menos 1. */
export function billableMinutes(startedAt: Date, endedAt: Date): number {
  const ms = endedAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / 60_000));
}

export function creditsForAudio(minutes: number): number {
  return Math.max(0, Math.floor(minutes)) * CREDITS_PER_AUDIO_MINUTE;
}

/** Créditos mensuales sugeridos para un plan según la cantidad de usuarios (usuarios × 1.600). */
export function suggestedMonthlyCredits(users: number): number {
  return Math.max(0, Math.floor(users)) * CREDITS_PER_USER;
}

/** Dólares de presupuesto de IA que equivalen a una cantidad de créditos. */
export function creditsToUsd(credits: number): number {
  return credits * CREDIT_USD;
}

/** Créditos que corresponden a un gasto real en dólares (para comparar lo cobrado con lo gastado). */
export function usdToCredits(usd: number): number {
  return usd / CREDIT_USD;
}

export interface CreditPack {
  id: string;
  /** Créditos con los que se creó el paquete. */
  credits: number;
  remaining: number;
  expiresAt: Date;
}

export interface CreditBalance {
  /** Créditos mensuales del plan; null = la organización no usa créditos. */
  monthlyTotal: number | null;
  monthlyUsed: number;
  monthlyRemaining: number;
  /** Suma de lo que queda en paquetes vigentes. */
  packsRemaining: number;
  /** Lo que se puede gastar ahora: mensual restante + paquetes. */
  available: number;
  /** Todo lo que se tuvo disponible este mes: bolsa mensual + paquetes vigentes con saldo (con lo que traían). */
  granted: number;
  /** Porcentaje gastado de `granted` (0–100). */
  percentUsed: number;
}

/** Los paquetes vigentes con saldo, el que vence antes primero. */
export function activePacks<T extends { remaining: number; expiresAt: Date }>(packs: T[], now: Date): T[] {
  return packs
    .filter((p) => p.remaining > 0 && p.expiresAt.getTime() > now.getTime())
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}

export function computeBalance(input: { monthlyTotal: number | null; monthlyUsed: number; packs: CreditPack[]; now: Date }): CreditBalance {
  const live = activePacks(input.packs, input.now);
  const packsRemaining = live.reduce((sum, p) => sum + p.remaining, 0);
  const packsGranted = live.reduce((sum, p) => sum + p.credits, 0);
  const monthlyTotal = input.monthlyTotal;
  const monthlyRemaining = monthlyTotal === null ? 0 : Math.max(0, monthlyTotal - input.monthlyUsed);
  const available = monthlyRemaining + packsRemaining;
  const granted = (monthlyTotal ?? 0) + packsGranted;
  const percentUsed = granted <= 0 ? (monthlyTotal === null ? 0 : 100) : ((granted - available) / granted) * 100;
  return {
    monthlyTotal,
    monthlyUsed: input.monthlyUsed,
    monthlyRemaining,
    packsRemaining,
    available,
    granted,
    percentUsed: Math.min(100, Math.max(0, Math.round(percentUsed * 10) / 10)),
  };
}

export interface ChargeSplit {
  fromMonthly: number;
  /** Cuánto sale de cada paquete (por id), en el orden en que se gastan. */
  fromPacks: { id: string; amount: number }[];
  /** Créditos que no había de dónde sacar (el consumo quedó por encima del saldo). */
  uncovered: number;
}

/** Reparte un cobro: primero la bolsa mensual, después los paquetes que vencen antes. */
export function splitCharge(amount: number, monthlyRemaining: number, packs: Pick<CreditPack, "id" | "remaining" | "expiresAt">[], now: Date): ChargeSplit {
  let left = Math.max(0, Math.floor(amount));
  const fromMonthly = Math.min(left, Math.max(0, monthlyRemaining));
  left -= fromMonthly;
  const fromPacks: { id: string; amount: number }[] = [];
  for (const pack of activePacks(packs, now)) {
    if (left <= 0) break;
    const take = Math.min(left, pack.remaining);
    fromPacks.push({ id: pack.id, amount: take });
    left -= take;
  }
  return { fromMonthly, fromPacks, uncovered: left };
}

export type CreditLevel = "ok" | "warn80" | "warn95" | "exhausted";

/** Nivel de aviso: 80% y 95% avisan al administrador; sin saldo se ofrece la recarga. */
export function creditLevel(balance: CreditBalance): CreditLevel {
  if (balance.monthlyTotal === null) return "ok";
  if (balance.available <= 0) return "exhausted";
  if (balance.percentUsed >= 95) return "warn95";
  if (balance.percentUsed >= 80) return "warn80";
  return "ok";
}

/**
 * ¿Se puede gastar IA ahora? Las funciones manuales se detienen al llegar a 0; el bot que contesta a los
 * clientes tiene una reserva de emergencia más para no dejar a un cliente sin respuesta de golpe.
 */
export function canSpend(balance: CreditBalance, opts: { automatic: boolean; overdraft: number }): boolean {
  if (balance.monthlyTotal === null) return true;
  if (balance.available > 0) return true;
  return opts.automatic && opts.overdraft < EMERGENCY_RESERVE;
}

/** 8000 → "8.000" (con punto de miles siempre, como en el modelo comercial; el locale es no lo pone en 4 cifras). */
export function formatCredits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Mensaje del aviso al administrador según el nivel. */
export function creditNoticeText(level: CreditLevel, balance: CreditBalance): string | null {
  if (level === "ok") return null;
  if (level === "exhausted") {
    return "Se acabaron los créditos de IA. El CRM sigue funcionando (contactos, pipeline, notas, tareas), pero las funciones de IA se detienen hasta que se renueven el mes que viene o se recargue.";
  }
  const pct = Math.floor(balance.percentUsed);
  if (level === "warn95") {
    return `Has usado el ${pct}% de tus créditos de IA. Quedan ${formatCredits(balance.available)}. Pide una recarga para no quedarte sin IA.`;
  }
  return `Has usado el ${pct}% de tus créditos de IA de este mes. Quedan ${formatCredits(balance.available)}.`;
}

/** Cuánto alcanza una cantidad de créditos si se gastara toda en una sola cosa (para entender cuánto es). */
export function creditEquivalents(credits: number) {
  const c = Math.max(0, credits);
  return {
    usd: creditsToUsd(c),
    botReplies: Math.floor(c / creditsForFeature("bot_calificacion")),
    analyses: Math.floor(c / creditsForFeature("seguimiento")),
    audioMinutes: Math.floor(c / CREDITS_PER_AUDIO_MINUTE),
  };
}

/** 90 → "1 h 30 min"; 45 → "45 min"; 120 → "2 h". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}
