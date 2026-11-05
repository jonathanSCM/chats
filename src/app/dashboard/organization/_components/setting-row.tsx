"use client";

import { useState, type ReactNode } from "react";
import { SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

/**
 * Un ajuste de la organización como fila compacta: nombre, cómo está hoy en una línea y un botón que abre
 * el formulario en una ventana lateral (con su X). Así la pantalla no es una pila de formularios abiertos.
 */
export function SettingRow({
  title,
  summary,
  actionLabel,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Cómo está hoy, en una línea. */
  summary?: ReactNode;
  actionLabel?: string;
  /** Explicación que se muestra arriba del formulario dentro de la ventana. */
  description?: ReactNode;
  /** Abierta desde el principio (por ejemplo, cuando falta terminar un paso). */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{title}</p>
          {summary && <div className="mt-0.5 truncate text-sm text-ink-muted">{summary}</div>}
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)} className="shrink-0">
          {actionLabel ?? t("Editar")}
        </Button>
      </div>
      {open && (
        <SidePanel
          onClose={() => setOpen(false)}
          header={
            <div>
              <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
              {description && <div className="mt-1 text-sm text-ink-muted">{description}</div>}
            </div>
          }
        >
          {children}
        </SidePanel>
      )}
    </>
  );
}
