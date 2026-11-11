"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/** Un script de Meet: botones para copiarlo completo o descargarlo como .user.js, y una vista del código. */
export function MeetScriptCard({
  title,
  description,
  file,
  version,
  code,
}: {
  title: string;
  description: string;
  file: string;
  version: string | null;
  code: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  async function copy() {
    setError(false);
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Respaldo para navegadores sin permiso al portapapeles: seleccionar el texto en un campo temporal.
      const area = document.createElement("textarea");
      area.value = code;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (!ok) {
        setError(true);
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {title}
            {version && <span className="ml-2 text-xs font-normal text-ink-faint">v{version}</span>}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? t("¡Copiado!") : t("Copiar script")}
          </button>
          <button
            type="button"
            onClick={download}
            title={t("Descargar archivo")}
            className="cursor-pointer rounded-md border border-border p-1.5 text-ink-muted hover:text-ink"
          >
            <Download size={14} />
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{t("No se pudo copiar: abre «Ver código», selecciónalo y cópialo a mano.")}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-accent">{t("Ver código")}</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-surface-2 p-2 text-[11px] leading-relaxed text-ink-muted">{code}</pre>
      </details>
    </div>
  );
}
