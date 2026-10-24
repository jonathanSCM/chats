/**
 * Estado compartido de "instalar la app". El navegador entrega UNA sola vez el
 * evento `beforeinstallprompt`; lo guardamos acá para que lo usen tanto el aviso
 * flotante (PwaPrompts) como el botón "Instalar en mi dispositivo" del perfil.
 * Solo se usa desde componentes de cliente.
 */

// Evento no estándar de Chrome/Edge/Samsung Internet para instalar la app.
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

import { detectLegacyAndroid } from "./android-version";

export interface InstallSnapshot {
  event: BeforeInstallPromptEvent | null;
  installed: boolean;
  /** Versión de Android ("8.1.0") si este teléfono no puede abrir una app instalada desde Chrome; null si sí. */
  legacyAndroid: string | null;
}

declare global {
  interface Window {
    /** Evento capturado por el script temprano del <head> (antes de que cargue React). */
    __pwaInstallEvent?: BeforeInstallPromptEvent;
  }
}

/**
 * Se ejecuta en el <head>, antes de React: si el navegador dispara el evento
 * antes de que la app termine de cargar, no se pierde.
 */
export const PWA_EARLY_CAPTURE_SCRIPT = `
(function () {
  try {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      window.__pwaInstallEvent = e;
    });
  } catch (e) {}
})();
`;

export const SERVER_INSTALL_SNAPSHOT: InstallSnapshot = { event: null, installed: false, legacyAndroid: null };

let snapshot: InstallSnapshot = SERVER_INSTALL_SNAPSHOT;
let started = false;
const listeners = new Set<() => void>();

function emit(next: Omit<InstallSnapshot, "legacyAndroid">) {
  snapshot = { ...next, legacyAndroid: snapshot.legacyAndroid };
  listeners.forEach((l) => l());
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  if (window.__pwaInstallEvent) snapshot = { ...snapshot, event: window.__pwaInstallEvent };

  // La versión real de Android sale de forma asíncrona; cuando llega se avisa a quien escucha.
  void detectLegacyAndroid().then((version) => {
    if (version === null) return;
    snapshot = { ...snapshot, legacyAndroid: version };
    listeners.forEach((l) => l());
  });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // lo ofrecemos con nuestros propios botones
    window.__pwaInstallEvent = e as BeforeInstallPromptEvent;
    emit({ event: e as BeforeInstallPromptEvent, installed: false });
  });
  window.addEventListener("appinstalled", () => {
    window.__pwaInstallEvent = undefined;
    emit({ event: null, installed: true });
  });
}

export function subscribeInstall(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInstallSnapshot(): InstallSnapshot {
  start();
  return snapshot;
}

/** Abre el diálogo de instalación del navegador. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = snapshot.event;
  if (!event) return "unavailable";
  await event.prompt();
  const choice = await event.userChoice;
  window.__pwaInstallEvent = undefined;
  emit({ event: null, installed: choice.outcome === "accepted" });
  return choice.outcome;
}
