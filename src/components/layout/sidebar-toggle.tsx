"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

/**
 * Pliega el menú lateral en escritorio para dar toda la pantalla al
 * contenido (la tabla de seguimiento tiene 13 columnas y cada píxel cuenta).
 *
 * No usa estado de React a propósito: el estado real vive en
 * `document.documentElement.dataset.sidebar`, puesto por el script del
 * layout antes de hidratar. Los dos íconos se renderizan siempre y el CSS
 * muestra el que corresponde, así no hay parpadeo ni desajuste al hidratar.
 */
export function SidebarToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.sidebar === "closed" ? "open" : "closed";
    root.dataset.sidebar = next;
    try {
      localStorage.setItem("sidebar", next);
    } catch {
      // Almacenamiento bloqueado: sigue funcionando, solo no se recuerda.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Mostrar u ocultar el menú"
      title="Mostrar u ocultar el menú"
      className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink md:flex"
    >
      <PanelLeftClose size={17} className="icon-when-open" />
      <PanelLeftOpen size={17} className="icon-when-closed" />
    </button>
  );
}
