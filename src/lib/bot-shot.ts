/**
 * Las capturas que manda el asistente (vexa-patches/apply-shots.js) traen la URL de la página que estaba viendo.
 * Con eso se distingue "está en la sala de espera de Meet" de "Meet lo mandó a otra página", sin mirar la imagen.
 */

export type ShotPageKind = "meet" | "inactive" | "sign-in" | "other";

export const SHOT_REASONS = {
  inactive:
    "La reunión ya no estaba activa: Meet mandó al asistente a su página de inicio (el link no abre una reunión en curso, o ya terminó).",
  "sign-in": "Meet pidió iniciar sesión con una cuenta de Google: esa reunión no deja entrar a invitados anónimos.",
} as const;

/** Qué página tenía abierta el asistente cuando sacó la captura. */
export function classifyShotPage(pageUrl: string): ShotPageKind {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return "other"; // about:blank, vacío…: no se concluye nada
  }
  if (url.protocol !== "https:") return "other";
  if (url.hostname === "meet.google.com") return url.pathname.startsWith("/landing") ? "inactive" : "meet";
  if (url.hostname === "accounts.google.com") return "sign-in";
  if (url.hostname === "workspace.google.com" || url.hostname === "google.com" || url.hostname === "www.google.com") {
    return "inactive";
  }
  return "other";
}

/** Nombre del adjunto: "captura · esperando 60s · meet.google.com.jpg" (sin caracteres raros). */
export function shotFileName(label: string, pageUrl: string): string {
  const clean = label.replace(/[^a-z0-9áéíóúñ -]+/gi, " ").replace(/\s+/g, " ").trim().slice(0, 50) || "sin etiqueta";
  let host = "";
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    /* sin host */
  }
  return `captura · ${clean}${host ? ` · ${host}` : ""}.jpg`;
}
