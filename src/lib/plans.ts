/**
 * Planes comerciales: una plantilla de lo que incluye cada plan. Estos son los valores que un plan fija en
 * la organización; el resto (clave de IA, marca configurada, etc.) lo sigue manejando cada organización.
 */

export interface PlanValues {
  maxAdmins: number | null;
  maxSellers: number | null;
  canHaveSubOrgs: boolean;
  maxSubOrgs: number | null;
  canCustomizeBrand: boolean;
  aiCreditsMonthly: number | null;
}

export const PLAN_VALUE_KEYS = [
  "maxAdmins",
  "maxSellers",
  "canHaveSubOrgs",
  "maxSubOrgs",
  "canCustomizeBrand",
  "aiCreditsMonthly",
] as const satisfies readonly (keyof PlanValues)[];

/** Sin suborganizaciones habilitadas el tope no tiene sentido: se guarda vacío para no dejar un dato engañoso. */
export function normalizePlanValues(v: PlanValues): PlanValues {
  return { ...v, maxSubOrgs: v.canHaveSubOrgs ? v.maxSubOrgs : null };
}

export function pickPlanValues(source: PlanValues): PlanValues {
  return {
    maxAdmins: source.maxAdmins,
    maxSellers: source.maxSellers,
    canHaveSubOrgs: source.canHaveSubOrgs,
    maxSubOrgs: source.maxSubOrgs,
    canCustomizeBrand: source.canCustomizeBrand,
    aiCreditsMonthly: source.aiCreditsMonthly,
  };
}

function count(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function limitText(n: number | null, singular: string, plural: string): string {
  if (n === null) return `${plural} sin límite`;
  return `${count(n)} ${n === 1 ? singular : plural}`;
}

/** Cómo se lee cada valor del plan para una persona. */
export function describeValue(key: keyof PlanValues, v: PlanValues): string {
  switch (key) {
    case "maxAdmins":
      return limitText(v.maxAdmins, "administrador", "administradores");
    case "maxSellers":
      return limitText(v.maxSellers, "vendedor", "vendedores");
    case "canHaveSubOrgs":
      return v.canHaveSubOrgs
        ? `suborganizaciones: ${v.maxSubOrgs === null ? "sin límite" : `hasta ${count(v.maxSubOrgs)}`}`
        : "sin suborganizaciones";
    case "maxSubOrgs":
      return v.maxSubOrgs === null ? "suborganizaciones sin límite" : `hasta ${count(v.maxSubOrgs)} suborganizaciones`;
    case "canCustomizeBrand":
      return v.canCustomizeBrand ? "marca propia (logo, nombre y color)" : "sin marca propia";
    case "aiCreditsMonthly":
      return v.aiCreditsMonthly === null ? "sin bolsa de créditos de IA" : `${count(v.aiCreditsMonthly)} créditos de IA por mes`;
  }
}

/** Resumen corto de lo que incluye un plan. */
export function describePlan(v: PlanValues): string[] {
  const n = normalizePlanValues(v);
  return [
    describeValue("maxAdmins", n),
    describeValue("maxSellers", n),
    describeValue("canHaveSubOrgs", n),
    describeValue("canCustomizeBrand", n),
    describeValue("aiCreditsMonthly", n),
  ];
}

/** Qué claves cambian entre dos versiones de los valores del plan. maxSubOrgs va junto con canHaveSubOrgs. */
export function changedKeys(before: PlanValues, after: PlanValues): (keyof PlanValues)[] {
  const b = normalizePlanValues(before);
  const a = normalizePlanValues(after);
  const keys: (keyof PlanValues)[] = [];
  for (const k of PLAN_VALUE_KEYS) {
    if (k === "maxSubOrgs") continue;
    if (k === "canHaveSubOrgs") {
      if (b.canHaveSubOrgs !== a.canHaveSubOrgs || b.maxSubOrgs !== a.maxSubOrgs) keys.push(k);
      continue;
    }
    if (b[k] !== a[k]) keys.push(k);
  }
  return keys;
}

/** Líneas "antes → después" de lo que cambió; vacío si no cambió nada. */
export function describeChanges(before: PlanValues, after: PlanValues): string[] {
  const b = normalizePlanValues(before);
  const a = normalizePlanValues(after);
  return changedKeys(b, a).map((k) => `${describeValue(k, b)} → ${describeValue(k, a)}`);
}

/** Texto del aviso que ve el dueño cuando cambia el plan de su organización; null si no cambió nada que le importe. */
export function planChangeNotice(args: {
  planName: string;
  before: PlanValues;
  after: PlanValues;
  /** Si el plan se cambió por otro, el nombre del anterior. */
  previousPlanName?: string | null;
}): string | null {
  const changes = describeChanges(args.before, args.after);
  const switched = Boolean(args.previousPlanName) && args.previousPlanName !== args.planName;
  if (changes.length === 0 && !switched) return null;
  const head = switched
    ? `Tu plan pasó de "${args.previousPlanName}" a "${args.planName}".`
    : `Tu plan "${args.planName}" se actualizó.`;
  const list = changes.length > 0 ? `\nQué cambió:\n${changes.map((c) => `• ${c}`).join("\n")}` : "";
  const now = `\nTu plan ahora incluye:\n${describePlan(args.after)
    .map((c) => `• ${c}`)
    .join("\n")}`;
  return `${head}${list}${now}`;
}

/** Precio mensual anotado, "S/ 249" o "S/ 249,50". */
export function formatPriceSoles(price: number | null): string {
  if (price === null) return "Sin precio";
  const text = Number.isInteger(price) ? String(price) : price.toFixed(2).replace(".", ",");
  return `S/ ${text}`;
}
