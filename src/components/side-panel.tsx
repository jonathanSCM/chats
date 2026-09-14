"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Chrome compartido del panel lateral (overlay + <aside> deslizante desde la
 * derecha) -- mismo patrón que DetailPanel en tracking-table.tsx, separado
 * acá para poder reusarlo en el detalle de una reunión sin duplicar el
 * portal/overlay/cierre. El contenido de cada caso de uso va en `children`.
 */
export function SidePanel({
  header,
  onClose,
  children,
}: {
  header: React.ReactNode;
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
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <aside className="relative flex w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-surface p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">{header}</div>
          <button type="button" onClick={onClose} className="shrink-0 cursor-pointer text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
