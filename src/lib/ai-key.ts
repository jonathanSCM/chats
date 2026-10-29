/**
 * Clave de OpenAI propia por organización. Esta parte es pura (sin base de datos ni red) para
 * poder probar la decisión de "qué clave usar" y "qué errores son definitivos".
 */

/**
 * Cómo usa la IA una organización (lo elige el superadmin):
 *  - "platform": la clave de la plataforma, con su tope diario (el de siempre).
 *  - "custom": una clave que pone el superadmin para esa organización, con tope de gasto y/o de tokens por mes.
 *  - "own": la clave que guarda la propia organización; el gasto es suyo y no hay tope de la plataforma.
 */
export const AI_MODES = ["platform", "custom", "own"] as const;
export type AiMode = (typeof AI_MODES)[number];

export function parseAiMode(value: unknown): AiMode {
  return AI_MODES.find((m) => m === value) ?? "platform";
}

export interface KeyHolder {
  mode: AiMode;
  hasKey: boolean;
  alertMessage: string | null;
}

export type KeyChoice =
  | { source: "platform" }
  | { source: "own" | "custom"; holder: "self" | "parent" }
  | { source: "blocked"; kind: "own" | "custom"; holder: "self" | "parent"; message: string };

/**
 * Qué clave usa una organización: la propia o la personalizada (según su modo y si ya hay una
 * guardada), la de su organización padre (las hijas la heredan) o la de la plataforma. Si esa
 * clave tiene un aviso de falla activo NO se cae a la de la plataforma: se bloquea hasta que se corrija.
 */
export function chooseKey(self: KeyHolder, parent: KeyHolder | null): KeyChoice {
  const candidates: Array<[KeyHolder, "self" | "parent"]> = [[self, "self"]];
  if (parent) candidates.push([parent, "parent"]);
  for (const [holder, who] of candidates) {
    if (holder.mode !== "platform" && holder.hasKey) {
      return holder.alertMessage
        ? { source: "blocked", kind: holder.mode, holder: who, message: holder.alertMessage }
        : { source: holder.mode, holder: who };
    }
  }
  return { source: "platform" };
}

export interface KeyFailure {
  /** true = no se arregla solo (clave inválida, revocada o sin saldo): se avisa al dueño y se detiene la IA. */
  definitive: boolean;
  message: string;
}

interface ApiErrorLike {
  status?: number;
  code?: string;
  type?: string;
  message?: string;
  error?: { type?: string; code?: string; message?: string };
}

/** Traduce un error de OpenAI a algo que el dueño entienda y dice si es definitivo. */
export function classifyKeyError(error: unknown): KeyFailure {
  const err = (error && typeof error === "object" ? error : {}) as ApiErrorLike;
  const code = err.code ?? err.error?.code;
  const type = err.type ?? err.error?.type;
  const text = (err.message ?? "").toLowerCase();

  if (code === "insufficient_quota" || type === "insufficient_quota" || code === "credit_balance_exhausted" || text.includes("exceeded your current quota")) {
    return { definitive: true, message: "Tu cuenta de OpenAI se quedó sin saldo. Recárgala o cambia la clave." };
  }
  if (err.status === 401 || code === "invalid_api_key" || type === "invalid_request_error" && text.includes("api key")) {
    return { definitive: true, message: "OpenAI rechazó tu clave: es inválida o fue revocada. Guarda una clave nueva." };
  }
  if (err.status === 403) {
    return { definitive: true, message: "Tu clave de OpenAI no tiene permiso para usar este modelo. Revisa los permisos del proyecto." };
  }
  return { definitive: false, message: err.message || "No se pudo comprobar la clave." };
}

const KEY_FORMAT = /^sk-[A-Za-z0-9_\-]{20,}$/;

export function isPlausibleOpenAiKey(key: string): boolean {
  return KEY_FORMAT.test(key.trim());
}

export function lastFour(key: string): string {
  return key.trim().slice(-4);
}
