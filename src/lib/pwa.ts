/**
 * Lógica pura de los avisos de la app instalable (PWA): cuándo ofrecer la
 * instalación y cuándo avisar que hay una versión nueva. Sin acceso al DOM
 * para poder probarla.
 */

/** Cada despliegue trae un identificador de versión distinto (ver next.config.ts). */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

export function isIOSDevice(userAgent: string, maxTouchPoints = 0): boolean {
  // iPadOS 13+ se presenta como Mac pero con pantalla táctil.
  return /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

/** Safari de iPhone/iPad (no Chrome, Firefox, Edge, Opera ni Google App, que en iOS también usan WebKit). */
export function isIOSSafari(userAgent: string, maxTouchPoints = 0): boolean {
  return isIOSDevice(userAgent, maxTouchPoints) && !/crios|fxios|edgios|opios|gsa\//i.test(userAgent);
}

/** Navegador interno de otra app (WhatsApp, Instagram, Facebook, TikTok...): ahí no se puede instalar. */
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|Snapchat|WhatsApp|;\s*wv\)/i.test(userAgent);
}

export function isMobileDevice(userAgent: string, maxTouchPoints = 0): boolean {
  return /android|iphone|ipad|ipod/i.test(userAgent) || isIOSDevice(userAgent, maxTouchPoints);
}

/**
 * Qué aviso de instalación corresponde en este dispositivo:
 *  - native: el navegador entregó el evento de instalar -> botón "Instalar".
 *  - ios-safari / ios-other-browser: iPhone/iPad. Desde iOS 16.4 también Chrome, Edge y Firefox pueden
 *    "Agregar a pantalla de inicio" desde Compartir; iOS nunca entrega el evento de instalar.
 *  - in-app-browser: abierto dentro de WhatsApp/Instagram/etc.: hay que abrirlo en el navegador.
 *  - legacy-android: Android 8 o menor; el WebAPK se cierra, se explica el acceso directo.
 *  - android-menu: Android sin evento (p. ej. se descartó antes): se explica el menú del navegador.
 * null = no mostrar nada (app instalada, escritorio, o todavía esperando el evento).
 */
export type InstallHintKind =
  | "native"
  | "ios-safari"
  | "ios-other-browser"
  | "in-app-browser"
  | "legacy-android"
  | "android-menu";

export interface InstallHintState {
  standalone: boolean;
  hasInstallEvent: boolean;
  /** Android 8 o menor (el WebAPK no abre). */
  legacyAndroid: boolean;
  userAgent: string;
  maxTouchPoints: number;
  /** Pasó el tiempo de gracia para que llegue el evento de instalar. */
  waitedForEvent: boolean;
}

export function installHintKind(s: InstallHintState): InstallHintKind | null {
  if (s.standalone) return null;
  const mobile = isMobileDevice(s.userAgent, s.maxTouchPoints);

  if (s.legacyAndroid) return "legacy-android";
  if (s.hasInstallEvent) return "native";
  if (!mobile) return null; // escritorio sin evento: nada que ofrecer
  if (isInAppBrowser(s.userAgent)) return "in-app-browser";
  if (isIOSSafari(s.userAgent, s.maxTouchPoints)) return "ios-safari";
  if (isIOSDevice(s.userAgent, s.maxTouchPoints)) return "ios-other-browser";
  return s.waitedForEvent ? "android-menu" : null;
}

/** Hay versión nueva si el servidor responde un identificador distinto al de este JS. */
export function isNewVersion(current: string, remote: string | null | undefined): boolean {
  if (!remote || remote === "dev" || current === "dev") return false;
  return remote !== current;
}
