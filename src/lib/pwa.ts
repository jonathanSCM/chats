/**
 * Lógica pura de los avisos de la app instalable (PWA): cuándo ofrecer la
 * instalación y cuándo avisar que hay una versión nueva. Sin acceso al DOM
 * para poder probarla.
 */

/** Cada despliegue trae un identificador de versión distinto (ver next.config.ts). */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/** Cuánto tiempo se respeta un "Ahora no" sobre la misma versión. */
export const DISMISS_DAYS = 30;
const DAY_MS = 86_400_000;

export interface DismissRecord {
  /** Versión de la app en la que la persona dijo "Ahora no". */
  v: string;
  /** Cuándo (ms desde 1970). */
  t: number;
}

export function parseDismissRecord(raw: string | null): DismissRecord | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<DismissRecord>;
    if (typeof data.v === "string" && typeof data.t === "number" && Number.isFinite(data.t)) {
      return { v: data.v, t: data.t };
    }
  } catch {
    // dato corrupto: se ignora
  }
  return null;
}

/**
 * El "Ahora no" vale solo para la misma versión y por un tiempo limitado:
 * cuando se despliega una versión nueva, la invitación a instalar vuelve a salir.
 */
export function isInstallDismissed(record: DismissRecord | null, buildId: string, now: number): boolean {
  if (!record) return false;
  if (record.v !== buildId) return false;
  return now - record.t < DISMISS_DAYS * DAY_MS;
}

export function isIOSDevice(userAgent: string, maxTouchPoints = 0): boolean {
  // iPadOS 13+ se presenta como Mac pero con pantalla táctil.
  return /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

/** En iOS solo Safari puede "Agregar a inicio"; Chrome/Firefox para iOS no. */
export function isIOSSafari(userAgent: string, maxTouchPoints = 0): boolean {
  return isIOSDevice(userAgent, maxTouchPoints) && !/crios|fxios|edgios|opios|gsa\//i.test(userAgent);
}

export interface InstallState {
  standalone: boolean;
  hasInstallEvent: boolean;
  iosSafari: boolean;
  dismissed: boolean;
}

export function shouldOfferInstall(s: InstallState): boolean {
  if (s.standalone || s.dismissed) return false;
  return s.hasInstallEvent || s.iosSafari;
}

/** Hay versión nueva si el servidor responde un identificador distinto al de este JS. */
export function isNewVersion(current: string, remote: string | null | undefined): boolean {
  if (!remote || remote === "dev" || current === "dev") return false;
  return remote !== current;
}
