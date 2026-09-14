"use client";

import { useRef, useState } from "react";
import { Pencil } from "lucide-react";

/**
 * Nombre de reunión editable en línea -- click (o el lápiz) lo convierte en
 * un input; Enter o perder el foco guarda, Escape cancela. Separado de
 * EditableText (tracking-table.tsx, pensado para textos largos con botón
 * "Guardar") porque acá el caso de uso es un nombre corto que se quiere
 * poder cambiar sin fricción, en cualquier estado de la reunión.
 */
export function EditableTitle({
  value,
  onSave,
  disabled,
  placeholder,
  className,
}: {
  value: string;
  onSave: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelledRef = useRef(false);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (cancelledRef.current) {
            cancelledRef.current = false;
            return;
          }
          setEditing(false);
          const trimmed = draft.trim();
          if (trimmed && trimmed !== value) onSave(trimmed);
          else setDraft(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelledRef.current = true;
            setDraft(value);
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        className={`w-full min-w-0 rounded-md border border-accent-dim bg-surface px-1.5 py-0.5 outline-none ${className ?? ""}`}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setEditing(true)}
      title="Click para cambiar el nombre"
      className={`group flex min-w-0 items-center gap-1.5 text-left disabled:cursor-not-allowed ${className ?? ""}`}
    >
      <span className="truncate">{value || placeholder}</span>
      {!disabled && (
        <Pencil size={12} className="shrink-0 text-ink-faint opacity-0 group-hover:opacity-100" />
      )}
    </button>
  );
}
