import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Sección plegable (cerrada por defecto) para lo que es largo o se consulta pocas veces. */
export function Fold({
  title,
  description,
  danger = false,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  danger?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className={`group mb-6 rounded-lg border bg-surface shadow-sm ${danger ? "border-danger/30" : "border-border"}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
        <div>
          <p className={`text-base font-semibold ${danger ? "text-danger" : "text-ink"}`}>{title}</p>
          {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
        </div>
        <ChevronDown size={18} className="shrink-0 text-ink-faint transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border p-5">{children}</div>
    </details>
  );
}
