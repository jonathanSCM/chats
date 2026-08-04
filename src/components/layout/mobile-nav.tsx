"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

// Barra superior + drawer para móvil. El contenido del drawer se pasa como
// children desde el layout (server component), así la navegación no se
// duplica entre la versión de escritorio y la de móvil.
export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // Con el drawer abierto, el fondo no debe hacer scroll.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 md:hidden"
      >
        <Menu size={20} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          {/* Al tocar un enlace o botón de la navegación, el drawer se cierra
              solo — se detecta por delegación en vez de observar la ruta. */}
          <aside
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a, button[type=submit]")) setOpen(false);
            }}
            className="animate-slide-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface px-3 py-5"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar menú"
              className="absolute right-3 top-4 flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2"
            >
              <X size={18} />
            </button>
            {children}
          </aside>
        </div>
      )}
    </>
  );
}
