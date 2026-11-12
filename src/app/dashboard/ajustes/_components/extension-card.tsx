"use client";

import { ExternalLink } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export const EXTENSION_STORE_URL = "https://chromewebstore.google.com/detail/nddohfckcipdmlakjpbbpffijmbgndfe";

/** La extensión de Chrome se instala y se actualiza sola desde la Chrome Web Store. */
export function ExtensionCard() {
  const t = useT();
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{t("ProShop CRM — Extensión de Chrome para Meet")}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {t("Panel lateral para grabar subtítulos y audio de Meet, elegir micrófono, pausar y volver a grabar.")}
          </p>
        </div>
        <a
          href={EXTENSION_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90"
        >
          <ExternalLink size={13} />
          {t("Instalar desde Chrome Web Store")}
        </a>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        {t("Se instala con un clic y Chrome la mantiene actualizada sola. Después fija su ícono en la barra y haz clic en él dentro de una reunión de Meet.")}
      </p>
    </div>
  );
}
