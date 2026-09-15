"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Chrome compartido del panel lateral -- overlay + <aside> que entra desde
 * la derecha con un leve rebote (animate-slide-in-right, ver globals.css) en
 * vez de aparecer de golpe. `accent` pinta una franja arriba (por defecto el
 * verde de acento de la marca) para que el panel tenga referencia visual de
 * qué reunión/estado estás mirando sin depender solo del texto -- pasale un
 * color distinto (ej. el del badge de estado del bot) para reforzarlo.
 */
export function SidePanel({
  header,
  accent,
  onClose,
  children,
}: {
  header: React.ReactNode;
  accent?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Se monta en el <body> por la misma razón que DetailPanel: un ancestro
  // con transform recortaría el panel al alto del contenido.
  return createPortal(
    <div data-portal className="fixed inset-0 z-[100] flex justify-end">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="animate-overlay-in absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <aside className="animate-slide-in-right relative flex w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl">
        <div
          className="h-1 shrink-0"
          style={{ background: accent ?? "var(--accent)" }}
        />
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">{header}</div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 cursor-pointer rounded-full p-1 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>
          <div className="space-y-4">{children}</div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Sección con etiqueta mono en mayúsculas -- mismo patrón que ya usa el
 * resto del panel ("REUNIONES INTERNAS", etc.) -- para que el detalle no sea
 * un bloque plano de controles sino grupos con jerarquía clara. `delay`
 * escalona la entrada (animate-fade-up ya existente) para que las secciones
 * aparezcan en cascada en vez de todas a la vez.
 */
export function PanelSection({
  label,
  delay = 0,
  children,
}: {
  label: string;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-fade-up space-y-1.5" style={{ animationDelay: `${delay}ms` }}>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      {children}
    </div>
  );
}
