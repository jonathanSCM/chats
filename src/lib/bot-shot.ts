/**
 * Las capturas que manda el asistente (vexa-patches/apply-shots.js) traen la URL de la página que estaba viendo.
 * Con eso se distingue "está en la sala de espera de Meet" de "Meet lo mandó a otra página", sin mirar la imagen.
 */

export type ShotPageKind = "meet" | "inactive" | "sign-in" | "other";

export const SHOT_REASONS = {
  // El asistente ni llegó a la sala: Meet lo mandó a su página de inicio al abrir el link.
  inactive:
    "Meet no abrió la sala y mandó al asistente a su página de inicio. Puede ser un rechazo pasajero de Google (el CRM reintenta solo), que el link no sea de una reunión en curso (ya terminó o no existe), o que sea una reunión de una cuenta de Google Workspace (empresa) que no admite invitados sin cuenta de Google.",
  // El asistente sí llegó a pedir entrada y Meet lo echó ("No puedes unirte a esta videollamada") sin que nadie respondiera.
  blocked:
    "Meet no dejó entrar al asistente: le mostró «No puedes unirte a esta videollamada» y lo devolvió a la página de inicio. Google rechaza a veces al asistente al azar (el CRM reintenta solo varias veces); si insiste en todos los intentos, la reunión puede ser de una cuenta de Google Workspace (empresa) que no admite invitados sin cuenta de Google, o el anfitrión la restringió. En ese caso usa la extensión de Chrome desde la reunión.",
  "sign-in": "Meet pidió iniciar sesión con una cuenta de Google: esa reunión no deja entrar a invitados anónimos.",
} as const;

/**
 * El motivo que se anota cuando una captura muestra que Meet sacó al asistente de la sala. Si ya había pedido entrar
 * (llegó a la sala de espera) y después apareció la página de inicio, Meet lo bloqueó; si nunca llegó a la sala, la
 * reunión no se abrió.
 */
export function shotFailureReason(kind: "inactive" | "sign-in", reachedLobby: boolean): string {
  if (kind === "sign-in") return SHOT_REASONS["sign-in"];
  return reachedLobby ? SHOT_REASONS.blocked : SHOT_REASONS.inactive;
}

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
