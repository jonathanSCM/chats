"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SERVER_INSTALL_SNAPSHOT,
  getInstallSnapshot,
  promptInstall,
  subscribeInstall,
} from "@/lib/pwa-install-store";
import { isIOSSafari } from "@/lib/pwa";

interface Device {
  standalone: boolean;
  iosSafari: boolean;
  oldBrowser: boolean;
}

/**
 * "Instalar en mi dispositivo": lo mismo que ofrece el aviso flotante, pero siempre
 * disponible acá por si la persona lo descartó o no lo vio.
 */
export function InstallAppCard() {
  const install = useSyncExternalStore(subscribeInstall, getInstallSnapshot, () => SERVER_INSTALL_SNAPSHOT);
  const [device, setDevice] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura única del navegador al montar
    setDevice({
      standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
      iosSafari: isIOSSafari(navigator.userAgent, navigator.maxTouchPoints),
      oldBrowser: Boolean((window as Window & { __legacyBrowser?: boolean }).__legacyBrowser),
    });
  }, []);

  async function handleInstall() {
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
    }
  }

  // Hasta saber en qué dispositivo estamos, no se muestra nada (evita parpadeo).
  if (!device) return <div className="h-10" aria-hidden />;

  if (device.standalone || install.installed) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink">
        <CheckCircle2 size={16} className="shrink-0 text-accent" />
        Ya estás usando la app instalada en este dispositivo.
      </p>
    );
  }

  if (install.event) {
    return (
      <Button onClick={handleInstall} disabled={busy}>
        <Download size={16} />
        {busy ? "Abriendo…" : "Instalar en mi dispositivo"}
      </Button>
    );
  }

  if (device.iosSafari) {
    return (
      <p className="flex flex-wrap items-center gap-1 text-sm text-ink">
        En iPhone o iPad: toca <Share size={14} className="inline" /> <b>Compartir</b> y luego{" "}
        <b>Agregar a pantalla de inicio</b>.
      </p>
    );
  }

  return (
    <div className="space-y-2 text-sm text-ink-muted">
      <p>
        Tu navegador no ofrece la instalación con un botón en este momento. Abre el menú del
        navegador (los tres puntos) y elige <b className="text-ink">Instalar aplicación</b> o{" "}
        <b className="text-ink">Agregar a pantalla de inicio</b>.
      </p>
      {device.oldBrowser && (
        <p className="text-warning">
          Tu navegador es antiguo: actualiza Chrome y «Android System WebView» desde Play Store
          (versión 111 o mayor).
        </p>
      )}
    </div>
  );
}
