"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Enlace del menú lateral. El texto va en `.nav-label` para que, con el menú
 * contraído (68 px, ver globals.css), solo quede el ícono; `title` lo explica.
 */
export function NavLink({
  href,
  exact,
  icon,
  children,
}: {
  href: string;
  exact?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={typeof children === "string" ? children : undefined}
      className={cn(
        "nav-item flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--sidebar-active)] font-semibold text-accent-dim"
          : "text-[var(--sidebar-ink)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-ink-strong)]",
      )}
    >
      <span className={cn("flex shrink-0 items-center", active && "text-accent-dim")}>{icon}</span>
      <span className="nav-label truncate">{children}</span>
    </Link>
  );
}
