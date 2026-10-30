import Link from "next/link";
import { Building2, Layers, LogOut, ScrollText, Settings, Users } from "lucide-react";
import { auth } from "@/server/auth";
import { logoutAction } from "@/server/actions/logout";
import { NavLink } from "@/components/layout/nav-link";
import { Logo } from "@/components/logo";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col overflow-y-auto bg-sidebar px-3 py-5">
        <Link href="/admin" className="mb-6 flex h-10 items-center gap-2 px-2">
          <Logo onDark />
          <Badge>Admin</Badge>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5">
          <NavLink href="/admin" exact icon={<Building2 size={18} />}>Organizaciones</NavLink>
          <NavLink href="/admin/planes" icon={<Layers size={18} />}>Planes</NavLink>
          <NavLink href="/admin/users" icon={<Users size={18} />}>Usuarios</NavLink>
          <NavLink href="/admin/logs" icon={<ScrollText size={18} />}>Registro</NavLink>
          <NavLink href="/admin/settings" icon={<Settings size={18} />}>Configuración</NavLink>
        </nav>

        <div className="mt-4 border-t border-[var(--sidebar-border)] pt-4">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-medium text-white">{session?.user.email}</p>
            <p className="text-xs text-[var(--sidebar-ink)]/70">superadmin</p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--sidebar-ink)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-white"
            >
              <LogOut size={18} /> Salir
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 bg-canvas px-8 py-8">{children}</main>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--sidebar-active)] px-2 py-0.5 text-xs font-medium text-accent-dim">
      {children}
    </span>
  );
}
