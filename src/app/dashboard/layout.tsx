import Link from "next/link";
import { redirect } from "next/navigation";
import {
  MessageCircle,
  ShieldCheck,
  LogOut,
  Building2,
  Smartphone,
  BookOpen,
  ClipboardList,
  CalendarDays,
  LayoutDashboard,
  Video,
  UserCircle,
} from "lucide-react";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { logoutAction } from "@/server/actions/logout";
import { NavLink } from "@/components/layout/nav-link";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { ServerClock } from "@/components/layout/server-clock";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { getUserMemberships } from "@/server/services/organization-membership";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // Un SUPERADMIN no pertenece a ninguna organización: este panel no aplica.
  if (session?.user.role === "SUPERADMIN" && !session.user.organizationId) {
    redirect("/admin");
  }

  // Alguien con sesión activa pero sin organización (lo sacaron del equipo,
  // por ejemplo) no puede quedarse en el panel: cada página de acá abajo
  // asume que hay una organización y se traba/rompe si no la hay.
  if (session?.user.role !== "SUPERADMIN" && !session?.user.organizationId) {
    redirect("/login?sinOrganizacion=1");
  }

  const org = session?.user.organizationId
    ? await prisma.organization.findUnique({ where: { id: session.user.organizationId } })
    : null;
  const memberships = session?.user.id
    ? await getUserMemberships(session.user.id).then((m) =>
        m.map((mm) => ({ organizationId: mm.organizationId, organizationName: mm.organizationName })),
      )
    : [];

  const serverNowIso = new Date().toISOString();
  // Antes usaba el huso horario del SO del servidor (UTC en producción, sin
  // relación con dónde está el negocio) -- ahora muestra la hora en la zona
  // horaria configurada de la organización (Organization.timezone, ver
  // "Horario de citas" en Organización), con Bolivia como default sensato
  // para cuando todavía no hay organización (login, superadmin sin org).
  const serverTimeZone = org?.timezone || "America/La_Paz";

  // Mismo contenido para el sidebar de escritorio y el drawer de móvil.
  const navContent = (
    <>
      <Link href="/dashboard" className="mb-8 px-2">
        <Logo />
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5">
        <NavLink href="/dashboard" exact>
          <LayoutDashboard size={16} /> Dashboard
        </NavLink>
        <NavLink href="/dashboard/inbox">
          <MessageCircle size={16} /> Chats
        </NavLink>
        <NavLink href="/dashboard/seguimiento">
          <ClipboardList size={16} /> Seguimiento
        </NavLink>
        <NavLink href="/dashboard/calendario">
          <CalendarDays size={16} /> Calendario
        </NavLink>
        <NavLink href="/dashboard/reuniones">
          <Video size={16} /> Reuniones
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
        <Link
          href="/dashboard/perfil"
          className="mb-2 block rounded-md px-2 py-1 transition-colors hover:bg-surface-2/60"
        >
          <p className="flex items-center gap-1.5 truncate text-sm text-ink">
            <UserCircle size={13} className="shrink-0 text-ink-faint" />
            {session?.user.email}
          </p>
          <p className="truncate font-mono text-[11px] text-ink-faint">
            {org?.name ?? "Sin organización"}
          </p>
          <ServerClock initialIso={serverNowIso} timeZone={serverTimeZone} />
        </Link>
        <ThemeToggle />
        {/* Selector solo si pertenece a más de una organización -- si no, no
            aparece nada acá (el nombre fijo de arriba alcanza). Afuera del
            Link de "Mi perfil" a propósito: adentro, un click para abrir el
            desplegable también disparaba la navegación del Link. */}
        {memberships.length > 1 && session?.user.organizationId && (
          <OrgSwitcher currentOrganizationId={session.user.organizationId} memberships={memberships} />
        )}
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
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar fijo: solo escritorio. overflow-y-auto propio por si el
          menú alguna vez no entra en pantallas bajas. */}
      <aside className="app-sidebar hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/60 px-3 py-5 md:flex">
        {navContent}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Hamburguesa en móvil; plegado del menú en escritorio. */}
        <header className="flex items-center gap-2 border-b border-border bg-surface/80 px-2 py-2 backdrop-blur">
          <MobileNav>{navContent}</MobileNav>
          <SidebarToggle />
          <span className="md:hidden">
            <Logo size="sm" />
          </span>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
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
