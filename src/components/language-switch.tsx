"use client";

import { useTransition } from "react";
import { Languages } from "lucide-react";
import { setLocaleAction } from "@/server/actions/locale";
import { useLocale } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
];

/** Guarda el idioma y recarga: varias pantallas piden sus datos desde el cliente y solo una recarga real las deja todas en el idioma nuevo. */
function useChangeLocale() {
  const [isPending, startTransition] = useTransition();
  const change = (locale: Locale) =>
    startTransition(async () => {
      const result = await setLocaleAction(locale);
      if (!result.error) window.location.reload();
    });
  return { isPending, change };
}

/** Las dos opciones a la vista (pantalla de Ajustes). */
export function LanguageSwitch() {
  const current = useLocale();
  const { isPending, change } = useChangeLocale();
  return (
    <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Language / Idioma">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={isPending}
          aria-pressed={current === o.value}
          onClick={() => o.value !== current && change(o.value)}
          className={`cursor-pointer rounded-md px-4 py-1.5 text-sm transition-colors disabled:opacity-50 ${
            current === o.value ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Botón del menú lateral: muestra el idioma al que se cambia (en su propio idioma, para que se entienda siempre). */
export function LanguageToggle() {
  const current = useLocale();
  const { isPending, change } = useChangeLocale();
  const target = OPTIONS.find((o) => o.value !== current) ?? OPTIONS[0];
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => change(target.value)}
      title={`${target.label} (${target.value.toUpperCase()})`}
      className="nav-item flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--sidebar-ink)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-white disabled:opacity-50"
    >
      <Languages size={18} />
      <span className="nav-label">{target.label}</span>
    </button>
  );
}
