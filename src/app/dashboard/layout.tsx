import Link from "next/link";
import { redirect } from "next/navigation";
import {
  MessageCircle,
  ShieldCheck,
  LogOut,
  Building2,
  Smartphone,
  BookOpen,
  KanbanSquare,
} from "lucide-react";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { logoutAction } from "@/server/actions/logout";
import { NavLink } from "@/components/layout/nav-link";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // Un SUPERADMIN no pertenece a ninguna organización: este panel no aplica.
  if (session?.user.role === "SUPERADMIN" && !session.user.organizationId) {
    redirect("/admin");
  }

  const org = session?.user.organizationId
    ? await prisma.organization.findUnique({ where: { id: session.user.organizationId } })
    : null;

  // Mismo contenido para el sidebar de escritorio y el drawer de móvil.
  const navContent = (
    <>
      <Link href="/dashboard" className="mb-8 px-2">
        <Logo />
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5">
        <NavLink href="/dashboard/inbox">
          <MessageCircle size={16} /> Chats
        </NavLink>
        <NavLink href="/dashboard/pipeline">
          <KanbanSquare size={16} /> Embudo
        </NavLink>
        <NavLink href="/dashboard/whatsapp">
          <Smartphone size={16} /> Conexión WhatsApp
        </NavLink>
        {session?.user.role === "OWNER" && (
          <>
            <NavLink href="/dashboard/knowledge">
              <BookOpen size={16} /> Conocimiento
            </NavLink>
            <NavLink href="/dashboard/organization">
              <Building2 size={16} /> Organización
            </NavLink>
          </>
        )}
        {session?.user.role === "SUPERADMIN" && (
          <NavLink href="/admin">
            <ShieldCheck size={16} /> Admin
          </NavLink>
        )}
      </nav>

      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-2 px-2">
          <p className="truncate text-sm text-ink">{session?.user.email}</p>
          <p className="truncate font-mono text-[11px] text-ink-faint">
            {org?.name ?? "Sin organización"}
          </p>
        </div>
        <ThemeToggle />
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-2/60 hover:text-danger"
          >
            <LogOut size={16} /> Salir
          </button>
        </form>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar fijo: solo escritorio */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface/60 px-3 py-5 md:flex">
        {navContent}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior con hamburguesa: solo móvil */}
        <header className="flex items-center gap-2 border-b border-border bg-surface/80 px-2 py-2 backdrop-blur md:hidden">
          <MobileNav>{navContent}</MobileNav>
          <Logo size="sm" />
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-8">
          {org?.suspended ? (
            <div className="mx-auto max-w-md rounded-lg border border-danger/40 bg-danger-dim px-6 py-8 text-center">
              <p className="mb-1 font-display text-lg font-semibold text-ink">
                Cuenta suspendida
              </p>
              <p className="text-sm text-ink-muted">
                Tu organización está suspendida y tus bots no responden mensajes. Contacta a
                soporte para más información.
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
