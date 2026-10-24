"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Download, RefreshCw, Share, X } from "lucide-react";
import { BUILD_ID, isIOSSafari, isNewVersion, shouldOfferInstall } from "@/lib/pwa";
import {
  SERVER_INSTALL_SNAPSHOT,
  getInstallSnapshot,
  promptInstall,
  subscribeInstall,
} from "@/lib/pwa-install-store";

const CHECK_EVERY_MS = 5 * 60_000;

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

/**
 * Dos avisos chicos abajo de la pantalla:
 *  1) "Instalar la app": acceso directo en la pantalla de inicio. Vuelve a salir
 *     cada vez que se despliega una versión nueva (mientras no esté instalada).
 *  2) "Hay una versión nueva": para que quien tiene la app abierta la actualice
 *     con un toque, sin esperar a cerrarla.
 * Nada de esto bloquea la pantalla y todo se puede descartar.
 */
export function PwaPrompts() {
  // El evento de instalación se comparte con el botón "Instalar en mi dispositivo" del perfil.
  const { event: installEvent, installed, legacyAndroid } = useSyncExternalStore(
    subscribeInstall,
    getInstallSnapshot,
    () => SERVER_INSTALL_SNAPSHOT,
  );
  const [standalone, setStandalone] = useState(true); // true hasta comprobar: evita parpadeo
  const [iosSafari, setIosSafari] = useState(false);
  // "Ahora no" solo oculta el aviso hasta que se recargue la página: no se guarda.
  const [dismissed, setDismissed] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // Estado inicial del dispositivo (solo en el navegador).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecturas únicas del navegador al montar
    setStandalone(isStandalone());
    setIosSafari(isIOSSafari(navigator.userAgent, navigator.maxTouchPoints));
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

  const dismissInstall = useCallback(() => {
    setDismissed(true);
    setShowIosHelp(false);
  }, []);

  const install = useCallback(async () => {
    if (installEvent) {
      const outcome = await promptInstall();
      if (outcome === "dismissed") dismissInstall();
      return;
    }
    setShowIosHelp(true); // iOS: no hay botón de instalar, se explican los pasos
  }, [installEvent, dismissInstall]);

  const offerInstall = shouldOfferInstall({
    standalone: standalone || installed,
    unsupported: legacyAndroid !== null,
    hasInstallEvent: installEvent !== null,
    iosSafari,
    dismissed,
  });

  if (!updateAvailable && !offerInstall) return null;

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

      {offerInstall && (
        <div
          role="dialog"
          aria-label="Instalar la app"
          className="pointer-events-auto w-full max-w-md rounded-card border border-border bg-surface p-3 shadow-lg"
        >
          <div className="flex items-start gap-3">
            <Download size={18} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Instala ProShop en tu pantalla de inicio</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                Acceso directo con un toque, pantalla completa y avisos de mensajes nuevos.
              </p>
              {showIosHelp && (
                <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-ink">
                  Toca <Share size={13} className="inline" /> <b>Compartir</b> y luego{" "}
                  <b>Agregar a pantalla de inicio</b>.
                </p>
              )}
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
          {!showIosHelp && (
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={dismissInstall}
                className="rounded-control px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
              >
                Ahora no
              </button>
              <button
                type="button"
                onClick={install}
                className="rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
              >
                Instalar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
