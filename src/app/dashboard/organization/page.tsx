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
import { getCreditUsageSummary, getOrgCredits, listCreditPacks } from "@/server/services/ai/credits";
import { AiCreditsPanel } from "@/components/ai-credits-panel";
import { PlanSummaryCard } from "@/components/plan-summary-card";
import { getPlanOverview } from "@/server/services/plans";
import { listRequests } from "@/server/services/credit-requests";
import { RequestCreditsForm, RequestRenewalForm, type PendingRequestView } from "./_components/request-forms";
import { SubOrgsPanel } from "./_components/suborgs-panel";
import { SettingRow } from "./_components/setting-row";
import { Fold } from "./_components/fold";
import { checkCalendarConnections, type CalendarConnectionStatus } from "@/server/services/google-calendar-user";
import { SharedCalendarForm } from "./_components/shared-calendar-form";
import { formatCredits } from "@/lib/ai-credits";
import { PLAN_STATE_LABEL } from "@/lib/plan-period";
import {
  ensureParentAdminsInChildren,
  listParentSellers,
  listSubOrganizations,
} from "@/server/services/suborganizations";
import { formatSeatUsage } from "@/lib/org-limits";
import { IntegrationApiPanel } from "./_components/integration-api-panel";
import { INTEGRATION_EVENT_TYPES } from "@/server/integrations/events";
import { getT } from "@/lib/i18n/server";

const TABS = [
  { key: "general", label: "General" },
  { key: "plan", label: "Plan y créditos" },
  { key: "equipo", label: "Equipo" },
  { key: "ventas", label: "Ventas" },
  { key: "integraciones", label: "Integraciones" },
  { key: "suborganizaciones", label: "Suborganizaciones" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const DAY_LABELS: Record<number, string> = { 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb", 0: "Dom" };

/** "Lun a vie" cuando son los cinco días hábiles seguidos; si no, la lista. */
function bookingDaysLabel(days: number[]): string {
  const ordered = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d));
  if (ordered.length === 0) return "Sin días";
  if (ordered.length === 5 && ordered.every((d, i) => d === i + 1)) return "Lun a vie";
  if (ordered.length === 7) return "Todos los días";
  return ordered.map((d) => DAY_LABELS[d]).join(", ");
}

export default async function OrganizationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ seccion?: string }>;
}) {
  const { seccion } = await searchParams;

  const session = await auth();
  const tr = await getT();
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
  const [credits, planOverview] = await Promise.all([getOrgCredits(org.id), getPlanOverview(org.id)]);
  const showSubOrgs = org.canHaveSubOrgs && !org.parentId;
  const showPlanTab = Boolean(credits || planOverview);
  const visibleTabs = TABS.filter(
    (t) => (t.key !== "suborganizaciones" || showSubOrgs) && (t.key !== "plan" || showPlanTab),
  );
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

  // Detalle de créditos y solicitudes: solo en la pestaña "Plan y créditos", que es donde se muestran.
  // Una suborganización ve la bolsa de su organización principal.
  const [creditSummary, creditPacks] =
    tab === "plan" && credits
      ? await Promise.all([getCreditUsageSummary(credits.rootOrgId), listCreditPacks(credits.rootOrgId)])
      : [null, []];
  const myRequests: PendingRequestView[] =
    tab === "plan"
      ? (await listRequests({ organizationId: org.id, limit: 8 })).map((r) => ({
          id: r.id,
          kind: r.kind,
          credits: r.credits,
          createdAt: r.createdAt.toISOString(),
          status: r.status,
        }))
      : [];
  const summaryDate = new Intl.DateTimeFormat("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: org.timezone || "America/La_Paz",
  });

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

  // Google Calendar conectado por cada persona del equipo (solo se consulta en la pestaña Equipo).
  const [calendarAccounts, calendarHealth] =
    tab === "equipo"
      ? await Promise.all([
          prisma.googleCalendarAccount.findMany({
            where: { userId: { in: members.map((m) => m.id) } },
            select: { userId: true, googleEmail: true },
          }),
          checkCalendarConnections(members.map((m) => m.id)),
        ])
      : [[], new Map<string, CalendarConnectionStatus>()];
  const calendarByUser = new Map(calendarAccounts.map((a) => [a.userId, a]));
  const brokenCalendars = calendarAccounts.filter((a) => calendarHealth.get(a.userId) === "broken").length;
  const workingCalendars = calendarAccounts.length - brokenCalendars;

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
      <h1 className="mb-1 text-2xl font-bold">{tr("Organización")}</h1>
      <p className="mb-6 text-sm text-ink-muted">{tr("Datos, plan, equipo, ventas e integraciones.")}</p>

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
            {tr(t.label)}
          </Link>
        ))}
      </nav>

      {tab === "general" && (
        <>
          {(planOverview || credits) && (
            <Card className="mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-ink-faint">Tu plan</p>
                  <p className="text-sm text-ink">
                    <b>{planOverview?.planName ?? "A medida"}</b>
                    {planOverview?.endsAt && (
                      <span className="text-ink-muted">
                        {" "}
                        · {PLAN_STATE_LABEL[planOverview.status.state].toLowerCase()}, hasta el {summaryDate.format(planOverview.endsAt)}
                      </span>
                    )}
                    {credits && (
                      <span className="text-ink-muted"> · {formatCredits(credits.balance.available)} créditos de IA disponibles</span>
                    )}
                  </p>
                </div>
                <Link href="/dashboard/organization?seccion=plan" className="text-sm font-medium text-accent hover:underline">
                  Ver plan y créditos
                </Link>
              </div>
              {credits && (
                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2"
                  role="progressbar"
                  aria-valuenow={Math.floor(credits.balance.percentUsed)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`h-full rounded-full ${credits.level === "exhausted" ? "bg-danger" : credits.level === "ok" ? "bg-accent" : "bg-warning"}`}
                    style={{ width: `${Math.max(credits.balance.percentUsed, credits.balance.percentUsed > 0 ? 2 : 0)}%` }}
                  />
                </div>
              )}
            </Card>
          )}

          <Card className="mb-6 divide-y divide-border">
            <SettingRow title="Nombre" summary={org.name} description="Cómo se llama tu organización dentro del CRM.">
              <RenameOrgForm currentName={org.name} />
            </SettingRow>

            {org.canCustomizeBrand && (
              <SettingRow
                title="Marca"
                summary={
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block size-3 rounded-full border border-border"
                      style={{ background: org.brandColor ?? "var(--accent)" }}
                    />
                    {org.brandName || org.name}
                    {org.assistantName ? ` · asistente “${org.assistantName}”` : ""}
                  </span>
                }
                description="Tu logo, nombre y color en el menú, los correos de invitación, el saludo del bot de WhatsApp y el nombre del asistente en las reuniones."
              >
                <BrandForm
                  brandName={org.brandName ?? ""}
                  assistantName={org.assistantName ?? ""}
                  brandColor={org.brandColor ?? ""}
                  logoPath={resolveBrand(org).logoPath}
                  brandDisplay={resolveBrand(org).display}
                  brandLogoShape={resolveBrand(org).logoShape}
                  brandLogoScale={resolveBrand(org).logoScale}
                />
              </SettingRow>
            )}

            <SettingRow
              title="Asesor IA"
              summary={`Analiza los últimos ${org.aiMessageLimit} mensajes de cada chat`}
              description="Cuánto contexto de la conversación recibe el asesor al analizar un cliente."
            >
              <AiSettingsForm currentLimit={org.aiMessageLimit} />
            </SettingRow>
          </Card>

          <Fold title="Zona de peligro" description="Exportar tus datos o eliminar la organización por completo." danger>
            <DangerZone orgName={org.name} />
          </Fold>
        </>
      )}

      {tab === "plan" && (
        <>
          {planOverview && (
            <Card className="mb-6" id="plan">
              <CardTitle className="mb-1">Mi plan</CardTitle>
              <CardDescription className="mb-4">Qué plan tiene tu organización y hasta cuándo está activo.</CardDescription>
              <PlanSummaryCard
                planName={planOverview.planName}
                state={planOverview.status.state}
                daysLeft={planOverview.status.daysLeft}
                endsAt={planOverview.endsAt}
                startedAt={planOverview.startedAt}
                includes={planOverview.includes}
                creditsRenewAt={credits?.renewsAt ?? null}
                fromParentName={planOverview.fromParentName}
              >
                <RequestRenewalForm requests={myRequests} highlight={["expiring", "grace", "expired"].includes(planOverview.status.state)} />
              </PlanSummaryCard>
            </Card>
          )}

          {credits && creditSummary && (
            <Card className="mb-6" id="creditos">
              <CardTitle className="mb-1">Créditos de IA</CardTitle>
              <CardDescription className="mb-4">
                La IA del CRM (bot de WhatsApp, asesor y resúmenes de reuniones) gasta créditos de una bolsa compartida por todo tu equipo. Si se acaban,
                el CRM sigue funcionando; solo se detienen las funciones de IA. Puedes pedir más créditos aquí abajo.
              </CardDescription>
              <AiCreditsPanel
                credits={credits}
                summary={creditSummary}
                packs={creditPacks}
                timeZone={org.timezone || "America/La_Paz"}
                fromParentName={parent?.name ?? null}
              />
              <div className="mt-6">
                <RequestCreditsForm requests={myRequests} />
              </div>
            </Card>
          )}
        </>
      )}

      {tab === "ventas" && (
        <>
          <Card className="mb-6 divide-y divide-border">
            <SettingRow
              title="Horario de citas"
              summary={`${bookingDaysLabel(org.bookingDays)} · ${org.bookingStartHour}:00 a ${org.bookingEndHour}:00 · ${org.bookingDurationMinutes} min`}
              description="Cuándo puede el bot de calificación ofrecer una reunión por WhatsApp."
            >
              <BookingSettingsForm
                currentTimezone={org.timezone}
                currentDays={org.bookingDays}
                currentStartHour={org.bookingStartHour}
                currentEndHour={org.bookingEndHour}
                currentDurationMinutes={org.bookingDurationMinutes}
                currentLeadHours={org.bookingLeadHours}
              />
            </SettingRow>

            {LEAD_AUTO_ASSIGN_AVAILABLE && (
              <SettingRow
                title="Asignación automática de leads"
                summary={org.autoAssignEnabled ? `Activada · avisa a los ${org.autoAssignSlaMinutes} min sin respuesta` : "Desactivada"}
                description="Reparte los leads nuevos por turnos entre tu equipo y avisa cuando un cliente se queda esperando respuesta."
              >
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
              </SettingRow>
            )}
          </Card>

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
        <Card className="mb-6 divide-y divide-border">
          {org.aiMode === "custom" && (
            <SettingRow
              title={tr("Inteligencia artificial")}
              actionLabel={tr("Ver")}
              summary={aiUsageText ? tr("Este mes: {usage}", { usage: aiUsageText }) : tr("Con límite mensual")}
              description={tr("Tu plan incluye IA con un límite mensual. Si lo alcanzas, la IA se detiene hasta el mes siguiente o hasta que el administrador de la plataforma lo amplíe.")}
            >
              {aiUsageText && <p className="text-sm text-ink-muted">{tr("Este mes: {usage}", { usage: aiUsageText })}</p>}
            </SettingRow>
          )}

          {org.aiMode === "own" && (
            <SettingRow
              title={tr("Clave de OpenAI")}
              actionLabel={tr("Configurar")}
              summary={
                org.aiKeyAlertMessage ? (
                  <span className="text-danger">{tr("Hay un problema con la clave")}</span>
                ) : org.openaiKeyLast4 ? (
                  tr("Clave terminada en {last4}", { last4: org.openaiKeyLast4 })
                ) : (
                  tr("Sin clave cargada")
                )
              }
              defaultOpen={Boolean(org.aiKeyAlertMessage)}
              description={tr("El bot de WhatsApp, el asesor y los resúmenes de reuniones pueden funcionar con tu propia cuenta de OpenAI en vez de la de la plataforma.")}
            >
              <OpenAiKeyForm last4={org.openaiKeyLast4} alertMessage={org.aiKeyAlertMessage} />
            </SettingRow>
          )}

          {isMarketingEnabled() && (
            <SettingRow
              title="Meta Ads"
              actionLabel={org.metaAdsAccessToken ? tr("Administrar") : tr("Conectar")}
              summary={
                org.metaAdsAccessToken
                  ? `${tr("Conectada")}${org.metaAdAccountName ? ` · ${org.metaAdAccountName}` : ""}`
                  : org.metaAdAccountId
                    ? tr("Hay que volver a conectarla")
                    : tr("No conectada")
              }
              defaultOpen={pendingAdAccounts.length > 0}
              description={tr("Conecta tu cuenta publicitaria con Facebook (solo lectura) para ver el gasto junto a tus ventas en Marketing — se sincroniza sola cada ~20h.")}
            >
              <MetaAdsConnect
                accountId={org.metaAdAccountId}
                accountName={org.metaAdAccountName}
                connected={Boolean(org.metaAdsAccessToken)}
                needsReconnect={!org.metaAdsAccessToken && Boolean(org.metaAdAccountId)}
                pendingAccounts={pendingAdAccounts}
                lastSyncedAt={org.metaAdsLastSyncedAt?.toISOString() ?? null}
              />
            </SettingRow>
          )}

          {/* Solo si el superadmin habilitó el Jefe de Operaciones para esta organización. */}
          {org.jefeEnabled && (
            <SettingRow
              title="API para integraciones"
              actionLabel="Configurar"
              summary={`${integrationKeys.filter((k) => !k.revokedAt).length} claves activas · aviso automático ${integrationWebhook?.enabled ? "activo" : "sin configurar"}`}
              description="Claves de API y avisos automáticos (webhook) para conectar otros sistemas, como el Jefe de Operaciones."
            >
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
            </SettingRow>
          )}
        </Card>
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
            <SettingRow
              title="Invitar a alguien"
              actionLabel="Invitar"
              summary={invites.length > 0 ? `${invites.length} ${invites.length === 1 ? "invitación pendiente" : "invitaciones pendientes"}` : "Genera un enlace y compártelo"}
              description="Genera un enlace y compártelo — quien lo abra se une como miembro."
            >
              <InvitePanel
                invites={invites.map((i) => ({
                  id: i.id,
                  email: i.email,
                  expiresAt: i.expiresAt.toISOString(),
                }))}
              />
            </SettingRow>
          </Card>

          <Card className="mb-6">
            <CardTitle className="mb-1">{tr("Google Calendar del equipo")}</CardTitle>
            <CardDescription className="mb-4">
              {tr("Quién tiene su calendario conectado. Las reuniones que agenda el bot van al calendario de la persona asignada si lo conectó; si no, al calendario compartido de la organización.")}
            </CardDescription>
            {brokenCalendars > 0 && (
              <p className="mb-3 rounded-control border border-danger/40 px-3 py-2 text-xs text-danger">
                {tr("{n} conexión(es) se desconectaron: esas reuniones no llegan al Google de esa persona (van al calendario compartido). Pídele que vuelva a conectarlo en Ajustes.", { n: brokenCalendars })}
              </p>
            )}
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              <li className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{tr("Calendario compartido de la organización")}</p>
                  <p className="text-xs text-ink-muted">
                    {org.googleCalendarId
                      ? tr("Creado en la cuenta de Google del CRM. Es el de respaldo cuando quien atiende no conectó el suyo.")
                      : tr("Todavía no se creó: se crea con la primera reunión que lo necesite.")}
                  </p>
                </div>
                <span className={`shrink-0 text-xs ${org.googleCalendarId ? "text-accent" : "text-ink-faint"}`}>
                  {org.googleCalendarId ? tr("Activo") : tr("Sin crear")}
                </span>
              </li>
              {members.map((m) => {
                const acc = calendarByUser.get(m.id);
                const health = acc ? calendarHealth.get(m.id) ?? "unknown" : null;
                const [label, tone] =
                  health === "ok"
                    ? [tr("Conectado"), "text-accent"]
                    : health === "broken"
                      ? [tr("Desconectado — debe volver a conectar"), "text-danger"]
                      : health === "unknown"
                        ? [tr("Conectado (no se pudo verificar ahora)"), "text-ink-muted"]
                        : [tr("Sin conectar"), "text-ink-faint"];
                return (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.name || m.email}</p>
                      <p className="truncate text-xs text-ink-muted">{acc ? acc.googleEmail : m.email}</p>
                    </div>
                    <span className={`shrink-0 text-right text-xs ${tone}`}>{label}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-ink-muted">
              {tr("Cada persona conecta el suyo en")} <Link href="/dashboard/ajustes" className="underline">{tr("Ajustes")}</Link>.{" "}
              {tr("Funcionando: {ok} de {total}.", { ok: workingCalendars, total: members.length })}
            </p>
          </Card>

          {org.googleCalendarId && (
            <Fold
              title={tr("Ver el calendario compartido en tu Google")}
              description={tr("Dale acceso de lectura a tu correo para ver todas las reuniones de la organización en un solo calendario.")}
            >
              <SharedCalendarForm sharedEmails={org.googleCalendarShares} />
            </Fold>
          )}

          <Fold title="Accesos por cuenta de WhatsApp" description="Marca a qué cuentas puede entrar cada vendedor — sin marcar, no ve esos chats.">
            <BotAccessMatrix
              bots={bots}
              members={vendedores.map((v) => ({ id: v.id, name: v.name ?? "", email: v.email, color: v.color }))}
              initialAccess={new Set(botMembers.map((bm) => `${bm.botId}:${bm.userId}`))}
            />
          </Fold>
        </>
      )}
    </div>
  );
}
