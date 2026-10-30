import Link from "next/link";

const TABS = [
  { key: "todas", label: "Todas", href: "/dashboard/reuniones/todas" },
  { key: "internas", label: "Internas", href: "/dashboard/reuniones" },
  { key: "calendario", label: "Calendario", href: "/dashboard/calendario" },
] as const;

/** Pestañas del área de reuniones: la lista de todas, las internas (sin cliente) y el calendario. */
export function ReunionesTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Secciones de reuniones">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${
            t.key === active
              ? "border-accent font-medium text-accent"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
