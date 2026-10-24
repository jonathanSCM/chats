"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Download, RefreshCw, Share, X } from "lucide-react";
import { BUILD_ID, installHintKind, isNewVersion, type InstallHintKind } from "@/lib/pwa";
import {
  SERVER_INSTALL_SNAPSHOT,
  getInstallSnapshot,
  promptInstall,
  subscribeInstall,
} from "@/lib/pwa-install-store";

const CHECK_EVERY_MS = 5 * 60_000;
// Tiempo para que el detector de Android viejo termine, y para que llegue el evento de instalar.
const SETTLE_MS = 1500;
const WAIT_FOR_EVENT_MS = 3500;

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

/** Texto del aviso según el caso (el título es siempre el mismo). */
function hintText(kind: InstallHintKind): { body: string; steps: React.ReactNode | null } {
  switch (kind) {
    case "native":
      return { body: "Acceso directo con un toque, pantalla completa y avisos de mensajes nuevos.", steps: null };
    case "ios-safari":
      return {
        body: "Acceso directo con un toque, pantalla completa y avisos de mensajes nuevos.",
        steps: (
          <>
            Toca <Share size={13} className="inline align-text-bottom" /> <b>Compartir</b> → <b>Agregar a pantalla de inicio</b> (si no lo ves,
            toca <b>Ver más</b>). Deja activado <b>Abrir como app web</b> y toca <b>Agregar</b>.
          </>
        ),
      };
    case "ios-other-browser":
      return {
        body: "Acceso directo con un toque, pantalla completa y avisos de mensajes nuevos.",
        steps: (
          <>
            Toca <Share size={13} className="inline align-text-bottom" /> <b>Compartir</b> (o el menú <b>⋯</b>) → <b>Agregar a pantalla de inicio</b>.
            Si no te aparece, abre esta página en <b>Safari</b>.
          </>
        ),
      };
    case "in-app-browser":
      return {
        body: "Estás dentro de otra app (WhatsApp, Instagram…), y desde ahí no se puede instalar.",
        steps: <>Toca los tres puntos y elige <b>Abrir en el navegador</b> (Chrome o Safari).</>,
      };
    case "legacy-android":
      return {
        body: "En tu Android la app instalada se cierra al abrirla, así que mejor crea un acceso directo.",
        steps: (
          <>
            En Chrome toca los tres puntos → <b>Agregar a pantalla de inicio</b> → <b>Crear acceso directo</b> (no «Instalar»).
          </>
        ),
      };
    case "android-menu":
      return {
        body: "Acceso directo con un toque, pantalla completa y avisos de mensajes nuevos.",
        steps: (
          <>
            En el navegador toca los tres puntos → <b>Instalar aplicación</b> (o <b>Agregar a pantalla de inicio</b>).
          </>
        ),
      };
  }
}

/**
 * Dos avisos chicos abajo de la pantalla:
 *  1) "Instala ProShop en tu pantalla de inicio": sale en cada carga mientras la app no esté
 *     instalada. Con botón "Instalar" si el navegador lo permite; si no, con los pasos que
 *     corresponden a ese teléfono (iPhone, WhatsApp/Instagram, Android viejo, menú de Chrome).
 *  2) "Hay una versión nueva": para que quien tiene la app abierta la actualice con un toque.
 * Nada de esto bloquea la pantalla y todo se puede descartar (hasta recargar).
 */
export function PwaPrompts() {
  // El evento de instalación se comparte con el botón "Instalar en mi dispositivo" del perfil.
  const { event: installEvent, installed, legacyAndroid } = useSyncExternalStore(
    subscribeInstall,
    getInstallSnapshot,
    () => SERVER_INSTALL_SNAPSHOT,
  );
  const [standalone, setStandalone] = useState(true); // true hasta comprobar: evita parpadeo
  const [device, setDevice] = useState({ userAgent: "", maxTouchPoints: 0 });
  // "Ahora no" solo oculta el aviso hasta que se recargue la página: no se guarda.
  const [dismissed, setDismissed] = useState(false);
  const [settled, setSettled] = useState(false);
  const [waitedForEvent, setWaitedForEvent] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // Estado inicial del dispositivo (solo en el navegador) y tiempos de espera.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecturas únicas del navegador al montar
    setStandalone(isStandalone());
    setDevice({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
    const t1 = window.setTimeout(() => setSettled(true), SETTLE_MS);
    const t2 = window.setTimeout(() => setWaitedForEvent(true), WAIT_FOR_EVENT_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  // ¿Hay una versión nueva desplegada? Se mira cada pocos minutos y al volver a la app.
  useEffect(() => {
    let stopped = false;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        if (!stopped && isNewVersion(BUILD_ID, data.version)) setUpdateAvailable(true);
      } catch {
        // sin conexión: se vuelve a intentar en el próximo ciclo
      }
    }

    const interval = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const dismissInstall = useCallback(() => setDismissed(true), []);

  const install = useCallback(async () => {
    const outcome = await promptInstall();
    if (outcome === "dismissed") dismissInstall();
  }, [dismissInstall]);

  // Hasta que pasa el tiempo de gracia no se decide nada: así un Android viejo no ve un
  // botón "Instalar" por un instante antes de que se detecte su versión.
  const kind: InstallHintKind | null =
    !settled || dismissed
      ? null
      : installHintKind({
          standalone: standalone || installed,
          hasInstallEvent: installEvent !== null,
          legacyAndroid: legacyAndroid !== null,
          userAgent: device.userAgent,
          maxTouchPoints: device.maxTouchPoints,
          waitedForEvent,
        });

  if (!updateAvailable && !kind) return null;

  const text = kind ? hintText(kind) : null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {updateAvailable && (
        <div
          role="status"
          className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-card border border-border bg-surface p-3 shadow-lg"
        >
          <RefreshCw size={18} className="shrink-0 text-accent" />
          <p className="min-w-0 flex-1 text-sm text-ink">Hay una versión nueva de la app.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
          >
            Actualizar
          </button>
        </div>
      )}

      {kind && text && (
        <div
          role="dialog"
          aria-label="Instalar la app"
          data-kind={kind}
          className="pointer-events-auto w-full max-w-md rounded-card border border-border bg-surface p-3 shadow-lg"
        >
          <div className="flex items-start gap-3">
            <Download size={18} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Instala ProShop en tu pantalla de inicio</p>
              <p className="mt-0.5 text-xs text-ink-muted">{text.body}</p>
              {text.steps && <p className="mt-2 text-xs leading-relaxed text-ink">{text.steps}</p>}
            </div>
            <button
              type="button"
              onClick={dismissInstall}
              aria-label="Ahora no"
              className="shrink-0 rounded-control p-1 text-ink-faint hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={dismissInstall}
              className="rounded-control px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
            >
              {kind === "native" ? "Ahora no" : "Entendido"}
            </button>
            {kind === "native" && (
              <button
                type="button"
                onClick={install}
                className="rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
              >
                Instalar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
