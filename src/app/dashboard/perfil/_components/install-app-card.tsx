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
import { isInAppBrowser, isIOSDevice, isIOSSafari } from "@/lib/pwa";

interface Device {
  standalone: boolean;
  iosSafari: boolean;
  ios: boolean;
  inApp: boolean;
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
      ios: isIOSDevice(navigator.userAgent, navigator.maxTouchPoints),
      inApp: isInAppBrowser(navigator.userAgent),
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

  if (install.legacyAndroid) {
    return (
      <div className="space-y-2 text-sm text-ink-muted">
        <p>
          Tu teléfono usa <b className="text-ink">Android {install.legacyAndroid}</b>. En ese Android, la app
          instalada desde Chrome se cierra al abrirla: es una limitación de Chrome, no de ProShop, por eso
          no te ofrecemos instalarla.
        </p>
        <p>
          Para tener un acceso directo en la pantalla de inicio: en Chrome toca los tres puntos →{" "}
          <b className="text-ink">Agregar a pantalla de inicio</b> y, si te da a elegir, escoge{" "}
          <b className="text-ink">Crear acceso directo</b> (no «Instalar»). Se abrirá en Chrome.
        </p>
        <p>Si ya instalaste la app y se cierra, mantén presionado su ícono y desinstálala.</p>
      </div>
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

  if (device.inApp) {
    return (
      <p className="text-sm text-ink-muted">
        Estás dentro de otra app (WhatsApp, Instagram…) y desde ahí no se puede instalar. Toca los tres puntos y
        elige <b className="text-ink">Abrir en el navegador</b> (Chrome o Safari); luego vuelve a esta pantalla.
      </p>
    );
  }

  if (device.ios) {
    return (
      <div className="space-y-2 text-sm text-ink-muted">
        <p>
          En iPhone o iPad: toca <Share size={14} className="inline align-text-bottom" />{" "}
          <b className="text-ink">Compartir</b> (o el menú <b className="text-ink">⋯</b>) →{" "}
          <b className="text-ink">Agregar a pantalla de inicio</b>. Si no lo ves, toca <b className="text-ink">Ver más</b>.
        </p>
        <p>
          Deja activado <b className="text-ink">Abrir como app web</b> y toca <b className="text-ink">Agregar</b>: así se
          abre en pantalla completa y puede recibir avisos de mensajes nuevos.
          {!device.iosSafari && " Si tu navegador no muestra esa opción, ábrelo en Safari."}
        </p>
      </div>
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
