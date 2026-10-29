/**
 * Clave de OpenAI propia por organización. Esta parte es pura (sin base de datos ni red) para
 * poder probar la decisión de "qué clave usar" y "qué errores son definitivos".
 */

export interface KeyHolder {
  aiOwnKeyEnabled: boolean;
  hasKey: boolean;
  alertMessage: string | null;
}

export type KeyChoice =
  | { source: "platform" }
  | { source: "own"; holder: "self" | "parent" }
  | { source: "blocked"; holder: "self" | "parent"; message: string };

/**
 * Qué clave usa una organización: la propia (si su plan lo permite y la guardó), la de su
 * organización padre (las hijas la heredan) o la de la plataforma. Si la clave propia tiene un
 * aviso de falla activo NO se cae a la de la plataforma: se bloquea hasta que la corrijan.
 */
export function chooseKey(self: KeyHolder, parent: KeyHolder | null): KeyChoice {
  const candidates: Array<[KeyHolder, "self" | "parent"]> = [[self, "self"]];
  if (parent) candidates.push([parent, "parent"]);
  for (const [holder, who] of candidates) {
    if (holder.aiOwnKeyEnabled && holder.hasKey) {
      return holder.alertMessage
        ? { source: "blocked", holder: who, message: holder.alertMessage }
        : { source: "own", holder: who };
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
