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
  Megaphone,
  Lightbulb,
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
import { isMarketingEnabled } from "@/lib/features";
import { accentStyle, BRAND_PARENT_SELECT, resolveOrgBrand } from "@/lib/brand";
import { getAiNotice } from "@/server/services/ai/notice";

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
    ? await prisma.organization.findUnique({
        where: { id: session.user.organizationId },
        include: { parent: { select: BRAND_PARENT_SELECT } },
      })
    : null;
  const brand = org ? resolveOrgBrand(org, org.parent) : null;
  // Solo el dueño ve el aviso de IA detenida, y solo se consulta si la organización no usa la clave de la plataforma.
  const aiNotice =
    org && session?.user.role === "OWNER" && (org.aiMode !== "platform" || org.parentId) ? await getAiNotice(org.id) : null;
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
      <Link href="/dashboard" className="nav-item mb-6 flex min-h-10 items-center px-2 py-1">
        <Logo
          onDark
          brandName={brand?.name}
          logoSrc={brand?.logoPath}
          display={brand?.display}
          logoShape={brand?.logoShape}
          logoScale={brand?.logoScale}
        />
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5">
        <NavLink href="/dashboard" exact icon={<LayoutDashboard size={18} />}>Dashboard</NavLink>
        <NavLink href="/dashboard/inbox" icon={<MessageCircle size={18} />}>Chats</NavLink>
        <NavLink href="/dashboard/seguimiento" icon={<ClipboardList size={18} />}>Seguimiento</NavLink>
        {isMarketingEnabled() && (
          <NavLink href="/dashboard/marketing" icon={<Megaphone size={18} />}>Marketing</NavLink>
        )}
        <NavLink href="/dashboard/calendario" icon={<CalendarDays size={18} />}>Calendario</NavLink>
        <NavLink href="/dashboard/reuniones" icon={<Video size={18} />}>Reuniones</NavLink>
        <NavLink href="/dashboard/whatsapp" icon={<Smartphone size={18} />}>Conexión WhatsApp</NavLink>
        {session?.user.role === "OWNER" && (
          <>
            <NavLink href="/dashboard/knowledge" icon={<BookOpen size={18} />}>Conocimiento</NavLink>
            <NavLink href="/dashboard/aprendizaje" icon={<Lightbulb size={18} />}>Aprendizaje</NavLink>
            <NavLink href="/dashboard/organization" icon={<Building2 size={18} />}>Organización</NavLink>
          </>
        )}
        {session?.user.role === "SUPERADMIN" && (
          <NavLink href="/admin" icon={<ShieldCheck size={18} />}>Admin</NavLink>
        )}
      </nav>

      <div className="mt-4 space-y-0.5 border-t border-[var(--sidebar-border)] pt-4">
        <Link
          href="/dashboard/perfil"
          className="nav-item mb-2 block rounded-lg px-2 py-2 transition-colors hover:bg-[var(--sidebar-hover)]"
        >
          <p className="nav-profile-row flex items-center gap-2 truncate text-sm font-medium text-white">
            <UserCircle size={18} className="shrink-0 text-[var(--sidebar-ink)]" />
            <span className="nav-label truncate">{session?.user.email}</span>
          </p>
          <p className="nav-extra truncate pl-[26px] text-xs text-[var(--sidebar-ink)]/70">
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
            className="nav-item flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--sidebar-ink)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-white"
          >
            <LogOut size={18} /> <span className="nav-label">Salir</span>
          </button>
        </form>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={accentStyle(brand?.color ?? null)}>
      {/* Sidebar fijo: solo escritorio. overflow-y-auto propio por si el
          menú alguna vez no entra en pantallas bajas. */}
      <aside className="app-sidebar hidden shrink-0 flex-col overflow-y-auto bg-sidebar px-3 py-5 md:flex">
        {navContent}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Hamburguesa en móvil; plegado del menú en escritorio. */}
        <header className="flex h-14 items-center gap-2 border-b border-border bg-surface px-3">
          <MobileNav>{navContent}</MobileNav>
          <SidebarToggle />
          <span className="md:hidden">
            <Logo
              size="sm"
              brandName={brand?.name}
              logoSrc={brand?.logoPath}
              display={brand?.display}
              logoShape={brand?.logoShape}
              logoScale={brand?.logoScale}
            />
          </span>
        </header>

        <main className="flex-1 overflow-y-auto bg-canvas px-4 py-5 md:px-6 md:py-6">
          {aiNotice && (
            <div className="mb-4 rounded-lg border border-danger/40 bg-danger-dim px-4 py-3 text-sm text-ink">
              <b className="text-danger">La IA de tu organización está detenida.</b> {aiNotice.message}{" "}
              {aiNotice.kind === "key-own" ? (
                <Link href="/dashboard/organization?seccion=integraciones" className="font-medium text-accent underline">
                  Actualizar la clave de OpenAI
                </Link>
              ) : (
                <span className="text-ink-muted">Avísale al administrador de la plataforma.</span>
              )}
            </div>
          )}
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
