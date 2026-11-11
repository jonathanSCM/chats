"use client";

import { Download } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/** Descarga de la extensión de Chrome con los pasos para cargarla. */
export function ExtensionCard({ version }: { version: string | null }) {
  const t = useT();
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {t("ProShop CRM — Extensión de Chrome para Meet")}
            {version && <span className="ml-2 text-xs font-normal text-ink-faint">v{version}</span>}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {t("Panel lateral para grabar subtítulos y audio de Meet, elegir micrófono, pausar y volver a grabar.")}
          </p>
        </div>
        <a
          href="/api/extension/download"
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90"
        >
          <Download size={13} />
          {t("Descargar extensión")}
        </a>
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-ink-muted">
        <li>{t("Descarga el .zip y descomprímelo en una carpeta que no vayas a borrar (por ejemplo, Documentos).")}</li>
        <li>{t("En Chrome abre chrome://extensions y activa «Modo de desarrollador» (arriba a la derecha).")}</li>
        <li>{t("Pulsa «Cargar extensión sin empaquetar» y elige esa carpeta.")}</li>
        <li>{t("Fija la extensión en la barra de Chrome y haz clic en su ícono dentro de una reunión de Meet.")}</li>
        <li>{t("Para actualizar: descarga el .zip nuevo, reemplaza los archivos de la carpeta y pulsa «Recargar» en chrome://extensions.")}</li>
      </ol>
    </div>
  );
}
