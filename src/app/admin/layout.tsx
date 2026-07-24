import Link from "next/link";
import { Building2, LogOut } from "lucide-react";
import { auth } from "@/server/auth";
import { logoutAction } from "@/server/actions/logout";
import { NavLink } from "@/components/layout/nav-link";
import { Logo } from "@/components/logo";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface/60 px-3 py-5">
        <Link href="/admin" className="mb-8 flex items-center gap-2 px-2">
          <Logo />
          <Badge>Admin</Badge>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5">
          <NavLink href="/admin" exact>
            <Building2 size={16} /> Organizaciones
          </NavLink>
        </nav>

        <div className="mt-4 border-t border-border pt-4">
          <div className="mb-2 px-2">
            <p className="truncate text-sm text-ink">{session?.user.email}</p>
            <p className="font-mono text-[11px] text-ink-faint">superadmin</p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-2/60 hover:text-danger"
            >
              <LogOut size={16} /> Salir
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-accent-dim/50 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">
      {children}
    </span>
  );
}
