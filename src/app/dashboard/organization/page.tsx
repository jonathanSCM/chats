import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { RenameOrgForm } from "./_components/rename-org-form";
import { BrandForm } from "./_components/brand-form";
import { OpenAiKeyForm } from "./_components/openai-key-form";
import { getMonthUsage } from "@/server/services/ai/client";
import { describeMonthlyUsage } from "@/lib/ai-limit";
import { resolveBrand } from "@/lib/brand";
import { MembersList } from "./_components/members-list";
import { InvitePanel } from "./_components/invite-panel";
import { AiSettingsForm } from "./_components/ai-settings-form";
import { LEAD_AUTO_ASSIGN_AVAILABLE } from "@/lib/lead-assignment";
import { AutoAssignSettings } from "./_components/auto-assign-settings";
import { BookingSettingsForm } from "./_components/booking-settings-form";
import { PipelineStagesList } from "./_components/pipeline-stages-list";
import { ServicesList } from "./_components/services-list";
import { BotAccessMatrix } from "./_components/bot-access-matrix";
import { MetaAdsConnect } from "./_components/meta-ads-connect";
import { listAdAccounts } from "@/server/services/meta-ads";
import { decrypt } from "@/lib/crypto";
import { getPlatformSettings } from "@/server/services/platform-settings";
import { isMarketingEnabled } from "@/lib/features";
import { DangerZone } from "./_components/danger-zone";
import { getSeatPlan } from "@/server/services/org-limits";
import { SubOrgsPanel } from "./_components/suborgs-panel";
import {
  ensureParentAdminsInChildren,
  listParentSellers,
  listSubOrganizations,
} from "@/server/services/suborganizations";
import { formatSeatUsage } from "@/lib/org-limits";
import { IntegrationApiPanel } from "./_components/integration-api-panel";
import { INTEGRATION_EVENT_TYPES } from "@/server/integrations/events";

const TABS = [
  { key: "general", label: "General" },
  { key: "equipo", label: "Equipo" },
  { key: "ventas", label: "Ventas" },
  { key: "integraciones", label: "Integraciones" },
  { key: "suborganizaciones", label: "Suborganizaciones" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function OrganizationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ seccion?: string }>;
}) {
  const { seccion } = await searchParams;

  const session = await auth();
  if (!session?.user.organizationId) redirect("/dashboard");
  if (session.user.role !== "OWNER") redirect("/dashboard");

  const seatPlan = await getSeatPlan(session.user.organizationId);
  const [org, memberships, invites, bots, botMembers, pipelineStages, services] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: session.user.organizationId } }),
    // Vía OrganizationMembership, no User.organizationId directo: alguien
    // sigue siendo del equipo de esta organización aunque tenga OTRA
    // organización activa ahora mismo. El rol también sale de la membresía
    // (es por organización, no global) -- SYSTEM son cuentas técnicas (ej.
    // el bot de subtítulos) sin dueño humano, no son equipo, no se muestran.
    prisma.organizationMembership.findMany({
      where: { organizationId: session.user.organizationId, user: { role: { not: "SYSTEM" } } },
      include: { user: { select: { id: true, name: true, email: true, color: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.organizationInvite.findMany({
      where: { organizationId: session.user.organizationId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.bot.findMany({
      where: { organizationId: session.user.organizationId },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.botMember.findMany({
      where: { bot: { organizationId: session.user.organizationId } },
      select: { botId: true, userId: true },
    }),
    prisma.pipelineStage.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { order: "asc" },
      include: { _count: { select: { opportunities: true } } },
    }),
    prisma.service.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { order: "asc" },
    }),
  ]);

  // La pestaña de suborganizaciones solo existe para una organización principal con esa opción en su plan.
  const showSubOrgs = org.canHaveSubOrgs && !org.parentId;
  const visibleTabs = TABS.filter((t) => t.key !== "suborganizaciones" || showSubOrgs);
  const tab: TabKey = visibleTabs.some((t) => t.key === seccion) ? (seccion as TabKey) : "general";
  const parent = org.parentId ? await prisma.organization.findUnique({ where: { id: org.parentId }, select: { name: true } }) : null;

  // Modo "custom": el dueño ve cuánto lleva usado de su tope mensual (solo lectura).
  const aiUsageText =
    tab === "integraciones" && org.aiMode === "custom"
      ? describeMonthlyUsage(
          { budgetUsd: org.aiMonthlyBudgetUsd, tokens: org.aiMonthlyTokenLimit },
          await getMonthUsage(org.id),
        )
      : null;

  let subOrgs: Awaited<ReturnType<typeof listSubOrganizations>> = [];
  let parentSellers: Awaited<ReturnType<typeof listParentSellers>> = [];
  if (tab === "suborganizaciones") {
    // Al día los accesos de los administradores antes de mostrar (por si alguien llegó después).
    await ensureParentAdminsInChildren(org.id);
    [subOrgs, parentSellers] = await Promise.all([listSubOrganizations(org.id), listParentSellers(org.id)]);
  }

  // Conectó con Facebook pero todavía no eligió cuenta (autorizó varias): se
  // vuelve a listar para mostrar el selector aunque haya recargado la página.
  const platform = await getPlatformSettings();
  const pendingAdAccounts =
    tab === "integraciones" && org.metaAdsAccessToken && !org.metaAdAccountId && isMarketingEnabled() && platform.whatsappAppId && platform.whatsappAppSecret
      ? await listAdAccounts(decrypt(org.metaAdsAccessToken), {
          appId: platform.whatsappAppId,
          appSecret: platform.whatsappAppSecret,
        }).catch(() => [])
      : [];

  const members = memberships.map((m) => ({
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    color: m.user.color,
    role: m.role,
    availableForLeads: m.availableForLeads,
  }));
  const vendedores = members.filter((m) => m.role === "MEMBER");

  // API de integración: solo se consulta cuando se mira esa pestaña.
  const [integrationKeys, integrationWebhook] =
    tab === "integraciones"
      ? await Promise.all([
          prisma.integrationKey.findMany({
            where: { organizationId: session.user.organizationId },
            orderBy: { createdAt: "desc" },
            select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, revokedAt: true },
          }),
          prisma.integrationWebhook.findFirst({ where: { organizationId: session.user.organizationId } }),
        ])
      : [[], null];

  return (
    <div className="max-w-2xl animate-fade-up">
      <h1 className="mb-1 text-2xl font-bold">Organización</h1>
      <p className="mb-6 text-sm text-ink-muted">Datos, equipo, ventas e integraciones.</p>

      {parent && (
        <p className="mb-6 rounded-control border border-border px-3 py-2 text-sm text-ink-muted">
          Esta es una suborganización de <b className="text-ink">{parent.name}</b>. Su plan de usuarios, su marca y su
          clave de OpenAI son los de la organización principal.
        </p>
      )}

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Secciones de la organización">
        {visibleTabs.map((t) => (
          <Link
            key={t.key}
            href={`/dashboard/organization?seccion=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${
              t.key === tab
                ? "border-accent font-medium text-accent"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "general" && (
        <>
      <Card className="mb-6">
        <CardTitle className="mb-4">Nombre</CardTitle>
        <RenameOrgForm currentName={org.name} />
      </Card>

      {org.canCustomizeBrand && (
        <Card className="mb-6">
          <CardTitle className="mb-1">Marca</CardTitle>
          <CardDescription className="mb-4">
            Tu logo, nombre y color en el menú, los correos de invitación, el saludo del bot de WhatsApp y el
            nombre del asistente en las reuniones.
          </CardDescription>
          <BrandForm
            brandName={org.brandName ?? ""}
            assistantName={org.assistantName ?? ""}
            brandColor={org.brandColor ?? ""}
            logoPath={resolveBrand(org).logoPath}
            brandDisplay={resolveBrand(org).display}
            brandLogoShape={resolveBrand(org).logoShape}
            brandLogoScale={resolveBrand(org).logoScale}
          />
        </Card>
      )}

      <Card className="mb-6">
        <CardTitle className="mb-1">Asesor IA</CardTitle>
        <CardDescription className="mb-4">
          Cuánto contexto de la conversación recibe el asesor al analizar un cliente.
        </CardDescription>
        <AiSettingsForm currentLimit={org.aiMessageLimit} />
      </Card>

      <Card className="border-danger/30">
        <CardTitle className="mb-1 text-danger">Zona de peligro</CardTitle>
        <CardDescription className="mb-4">
          Exportar tus datos o eliminar la organización por completo.
        </CardDescription>
        <DangerZone orgName={org.name} />
      </Card>
        </>
      )}

      {tab === "ventas" && (
        <>

      <Card className="mb-6">
        <CardTitle className="mb-1">Horario de citas</CardTitle>
        <CardDescription className="mb-4">
          Cuándo puede el bot de calificación ofrecer una reunión por WhatsApp.
        </CardDescription>
        <BookingSettingsForm
          currentTimezone={org.timezone}
          currentDays={org.bookingDays}
          currentStartHour={org.bookingStartHour}
          currentEndHour={org.bookingEndHour}
          currentDurationMinutes={org.bookingDurationMinutes}
          currentLeadHours={org.bookingLeadHours}
        />
      </Card>

      {LEAD_AUTO_ASSIGN_AVAILABLE && (
        <Card className="mb-6">
          <CardTitle className="mb-1">Asignación automática de leads</CardTitle>
          <CardDescription className="mb-4">
            Reparte los leads nuevos por turnos entre tu equipo y avisa cuando un cliente se queda esperando
            respuesta.
          </CardDescription>
          <AutoAssignSettings
            enabled={org.autoAssignEnabled}
            slaMinutes={org.autoAssignSlaMinutes}
            maxOpen={org.autoAssignMaxOpen}
            members={members.map((m) => ({
              id: m.id,
              name: m.name,
              email: m.email,
              role: m.role,
              availableForLeads: m.availableForLeads,
            }))}
          />
        </Card>
      )}

      <Card className="mb-6">
        <CardTitle className="mb-1">Pipeline comercial</CardTitle>
        <CardDescription className="mb-4">
          Las etapas por las que pasa una oportunidad. Ganado, Perdido y En pausa / Nutrir son del
          sistema (se pueden renombrar, no borrar) — el resto lo definís vos: nombre, color, orden,
          agregar o quitar.
        </CardDescription>
        <PipelineStagesList
          stages={pipelineStages.map((s) => ({
            id: s.id,
            label: s.label,
            color: s.color,
            role: s.role,
            isDefaultEntry: s.isDefaultEntry,
            opportunityCount: s._count.opportunities,
          }))}
        />
      </Card>

      <Card className="mb-6">
        <CardTitle className="mb-1">Servicios</CardTitle>
        <CardDescription className="mb-4">
          Las opciones de &quot;servicio de interés&quot; al cargar una oportunidad — nombre, orden, agregar o
          quitar. Borrar una no afecta a los clientes que ya tenían ese servicio cargado.
        </CardDescription>
        <ServicesList services={services} />
      </Card>

        </>
      )}

      {tab === "suborganizaciones" && showSubOrgs && (
        <Card className="mb-6">
          <CardTitle className="mb-1">Suborganizaciones</CardTitle>
          <CardDescription className="mb-4">
            Cada una tiene sus propios chats, contactos y números de WhatsApp, separados de los tuyos. Tú eliges qué
            vendedores trabajan en cada una; los administradores entran a todas.
          </CardDescription>
          <SubOrgsPanel
            subOrgs={subOrgs.map((s) => ({ id: s.id, name: s.name, sellerIds: s.sellerIds }))}
            sellers={parentSellers}
            maxSubOrgs={org.maxSubOrgs}
          />
        </Card>
      )}

      {tab === "integraciones" && (
        <>
      {org.aiMode === "custom" && (
        <Card className="mb-6">
          <CardTitle className="mb-1">Inteligencia artificial</CardTitle>
          <CardDescription className="mb-3">
            Tu plan incluye IA con un límite mensual. Si lo alcanzas, la IA se detiene hasta el mes siguiente o hasta
            que el administrador de la plataforma lo amplíe.
          </CardDescription>
          {aiUsageText && <p className="text-sm text-ink-muted">Este mes: {aiUsageText}</p>}
        </Card>
      )}

      {org.aiMode === "own" && (
        <Card className="mb-6">
          <CardTitle className="mb-1">Clave de OpenAI</CardTitle>
          <CardDescription className="mb-4">
            El bot de WhatsApp, el asesor y los resúmenes de reuniones pueden funcionar con tu propia cuenta de
            OpenAI en vez de la de la plataforma.
          </CardDescription>
          <OpenAiKeyForm last4={org.openaiKeyLast4} alertMessage={org.aiKeyAlertMessage} />
        </Card>
      )}
      {isMarketingEnabled() && (
        <Card className="mb-6">
          <CardTitle className="mb-1">Meta Ads</CardTitle>
          <CardDescription className="mb-4">
            Conectá tu cuenta publicitaria con Facebook (solo lectura) para ver el gasto junto a tus
            ventas en Marketing — se sincroniza sola cada ~20h.
          </CardDescription>
          <MetaAdsConnect
            accountId={org.metaAdAccountId}
            accountName={org.metaAdAccountName}
            connected={Boolean(org.metaAdsAccessToken)}
            needsReconnect={!org.metaAdsAccessToken && Boolean(org.metaAdAccountId)}
            pendingAccounts={pendingAdAccounts}
            lastSyncedAt={org.metaAdsLastSyncedAt?.toISOString() ?? null}
          />
        </Card>
      )}

      <Card className="mb-6">
        <CardTitle className="mb-1">Extensión de subtítulos para Meet</CardTitle>
        <CardDescription className="mb-4">
          Extensión de Chrome que lee los subtítulos en vivo de Google Meet desde el navegador de
          quien esté en la reunión — no hace falta que un bot pida entrar ni que nadie lo admita.
          Función aparte del bot grabador: el bot sigue disponible para cuando sí se necesita audio.
          Cada vendedor se identifica solo, con su propia sesión del CRM — no hace falta generar ni
          pegar ningún token: instalá la extensión, tocá su ícono y elegí &quot;Iniciar sesión&quot;.
        </CardDescription>
      </Card>

      {/* Solo si el superadmin habilitó el Jefe de Operaciones para esta organización. */}
      {org.jefeEnabled && (
      <Card className="mb-6">
        <CardTitle className="mb-1">API para integraciones</CardTitle>
        <CardDescription className="mb-4">
          Claves de API y avisos automáticos (webhook) para conectar otros sistemas, como el Jefe de Operaciones.
        </CardDescription>
        <IntegrationApiPanel
          keys={integrationKeys.map((k) => ({
            id: k.id,
            name: k.name,
            prefix: k.prefix,
            scopes: k.scopes,
            lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
            revokedAt: k.revokedAt?.toISOString() ?? null,
          }))}
          webhook={
            integrationWebhook
              ? {
                  url: integrationWebhook.url,
                  events: integrationWebhook.events,
                  enabled: integrationWebhook.enabled,
                  lastSuccessAt: integrationWebhook.lastSuccessAt?.toISOString() ?? null,
                  lastFailureAt: integrationWebhook.lastFailureAt?.toISOString() ?? null,
                  lastError: integrationWebhook.lastError,
                }
              : null
          }
          availableEvents={[...INTEGRATION_EVENT_TYPES]}
        />
      </Card>
      )}
        </>
      )}

      {tab === "equipo" && (
        <>
      <Card className="mb-6">
        <CardTitle className="mb-1">Equipo</CardTitle>
        <CardDescription className="mb-4">
          Todos los que tienen acceso a tus bots y conversaciones.
        </CardDescription>
        {(seatPlan.limits.maxAdmins !== null || seatPlan.limits.maxSellers !== null) && (
          <p className="mb-3 rounded-control border border-border px-3 py-2 text-xs text-ink-muted">
            Tu plan{seatPlan.isGroup ? " (compartido con tus suborganizaciones)" : ""} — administradores:{" "}
            {formatSeatUsage(seatPlan.counts.admins, seatPlan.limits.maxAdmins)} · vendedores:{" "}
            {formatSeatUsage(seatPlan.counts.sellers, seatPlan.limits.maxSellers)}
          </p>
        )}
        <MembersList members={members} currentUserId={session.user.id} />
      </Card>

      <Card className="mb-6">
        <CardTitle className="mb-1">Accesos por cuenta de WhatsApp</CardTitle>
        <CardDescription className="mb-4">
          Marca a qué cuentas puede entrar cada vendedor — sin marcar, no ve esos chats.
        </CardDescription>
        <BotAccessMatrix
          bots={bots}
          members={vendedores.map((v) => ({ id: v.id, name: v.name ?? "", email: v.email, color: v.color }))}
          initialAccess={new Set(botMembers.map((bm) => `${bm.botId}:${bm.userId}`))}
        />
      </Card>

      <Card className="mb-6">
        <CardTitle className="mb-1">Invitar a alguien</CardTitle>
        <CardDescription className="mb-4">
          Genera un enlace y compártelo — quien lo abra se une como miembro.
        </CardDescription>
        <InvitePanel
          invites={invites.map((i) => ({
            id: i.id,
            email: i.email,
            expiresAt: i.expiresAt.toISOString(),
          }))}
        />
      </Card>

        </>
      )}
    </div>
  );
}
