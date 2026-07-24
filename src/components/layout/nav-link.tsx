"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function NavLink({
  href,
  exact,
  children,
}: {
  href: string;
  exact?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-surface-2 text-ink"
          : "text-ink-muted hover:bg-surface-2/60 hover:text-ink",
      )}
    >
      {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      {!active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-transparent" />}
      {children}
    </Link>
  );
}
