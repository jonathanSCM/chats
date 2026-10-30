import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { SuspendToggle } from "./_components/suspend-toggle";
import { JefeToggle } from "./_components/jefe-toggle";
import { DisconnectWhatsAppButton } from "./_components/disconnect-whatsapp-button";
import { PlanForm } from "./_components/plan-form";
import { AiForm } from "./_components/ai-form";
import { PlanAssignForm } from "./_components/plan-assign-form";
import { listPlans, planToValues } from "@/server/services/plans";
import { changedKeys, describePlan, formatPrice } from "@/lib/plans";
import { ParentForm } from "./_components/parent-form";
import { countParentUsersInOrg, listEligibleParents } from "@/server/services/org-hierarchy-admin";
import { getMonthUsage } from "@/server/services/ai/client";
import { checkMonthlyLimit, describeMonthlyUsage } from "@/lib/ai-limit";
import { parseAiMode } from "@/lib/ai-key";
import { getSeatCounts } from "@/server/services/org-limits";
import { formatSeatUsage } from "@/lib/org-limits";
import { formatCredits } from "@/lib/ai-credits";
import { getCreditUsageSummary, getOrgCredits, listCreditPacks } from "@/server/services/ai/credits";
import { AiCreditsPanel } from "@/components/ai-credits-panel";
import { CreditsExplainer } from "@/components/credits-explainer";
import { PlanValidity } from "./_components/plan-validity";
import { planDateLabel } from "@/components/plan-summary-card";
import { PLAN_STATE_LABEL, planStatus } from "@/lib/plan-period";
import { AddPackForm, CancelPackButton, CreditsPlanForm } from "./_components/credits-admin";
import type { BotStatus } from "@/generated/prisma/enums";

const botStatusTone: Record<BotStatus, "accent" | "warning" | "neutral"> = {
  ACTIVE: "accent",
  PAUSED: "warning",
  DRAFT: "neutral",
};

const TABS = [
  { key: "resumen", label: "Resumen" },
  { key: "plan", label: "Plan y créditos" },
  { key: "ia", label: "Inteligencia artificial" },
  { key: "conexiones", label: "Conexiones" },
  { key: "usuarios", label: "Usuarios" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const AI_MODE_LABEL: Record<string, string> = {
  platform: "Clave de la plataforma",
  custom: "Clave personalizada con límite",
  own: "Clave propia de la organización",
};

export default async function AdminOrganizationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ seccion?: string }>;
}) {
  const { id } = await params;
  const { seccion } = await searchParams;

  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, name: true } },
      plan: { select: { name: true } },
      children: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } },
      bots: { include: { whatsappConnection: true, _count: { select: { conversations: true } } } },
      integrationKeys: { where: { revokedAt: null }, select: { id: true } },
      integrationWebhooks: { select: { enabled: true, lastSuccessAt: true, lastError: true } },
      memberships: {
        where: { user: { role: { not: "SYSTEM" } } },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!org) notFound();

  const [seats, subOrgs] = await Promise.all([
    getSeatCounts(org.id),
    prisma.organization.count({ where: { parentId: org.id } }),
  ]);
  const tab: TabKey = TABS.some((x) => x.key === seccion) ? (seccion as TabKey) : "resumen";
  // Cada pestaña consulta solo lo que muestra.
  const [eligibleParents, parentUsersInOrg] =
    tab === "resumen"
      ? await Promise.all([
          listEligibleParents(org.id),
          org.parent ? countParentUsersInOrg(org.id, org.parent.id) : Promise.resolve(0),
        ])
      : [[], 0];
  const aiMode = parseAiMode(org.aiMode);
  const plans = org.parent || tab !== "plan" ? [] : await listPlans();
  const currentPlan = plans.find((p) => p.id === org.planId) ?? null;
  const planIsCustom = currentPlan ? changedKeys(currentPlan.values, planToValues(org)).length > 0 : false;
  const aiLimits = { budgetUsd: org.aiMonthlyBudgetUsd, tokens: org.aiMonthlyTokenLimit };
  const aiUsage = tab === "ia" && aiMode === "custom" ? await getMonthUsage(org.id) : null;
  const aiStatus = aiUsage ? checkMonthlyLimit(aiLimits, aiUsage) : null;
  // Créditos de IA: la bolsa es de la organización principal; una suborganización solo apunta a ella.
  const credits = org.parent || (tab !== "plan" && tab !== "resumen") ? null : await getOrgCredits(org.id);
  const [creditSummary, creditPacks] =
    credits && tab === "plan"
      ? await Promise.all([getCreditUsageSummary(org.id), listCreditPacks(org.id)])
      : [null, []];
  const validity = planStatus(org.planEndsAt, new Date());
  const pendingRequests = tab === "resumen" ? await prisma.creditRequest.count({ where: { organizationId: org.id, status: "PENDING" } }) : 0;
  const validityDays =
    org.planEndsAt && validity.daysLeft !== null
      ? validity.daysLeft > 0
        ? validity.daysLeft === 1
          ? "queda 1 día"
          : `quedan ${validity.daysLeft} días`
        : validity.daysLeft === 0
          ? "vence hoy"
          : `venció hace ${Math.abs(validity.daysLeft)} día${Math.abs(validity.daysLeft) === 1 ? "" : "s"}`
      : null;
  const connectedNumbers = org.bots.filter((b) => b.whatsappConnection?.verified).length;

  return (
    <div className="max-w-3xl animate-fade-up">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{org.name}</h1>
          <p className="font-code text-xs text-ink-faint">{org.slug}</p>
          {org.parent && (
            <p className="mt-1 text-xs text-ink-muted">
              Suborganización de{" "}
              <Link href={`/admin/organizations/${org.parent.id}`} className="text-accent hover:underline">
                {org.parent.name}
              </Link>
              . Su plan de usuarios, su marca y su clave de OpenAI son los de la organización principal.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {org.suspended && <Badge tone="danger">Suspendida</Badge>}
          <SuspendToggle orgId={org.id} suspended={org.suspended} />
        </div>
      </div>

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Secciones de la organización">
        {TABS.map((x) => (
          <Link
            key={x.key}
            href={`/admin/organizations/${org.id}?seccion=${x.key}`}
            aria-current={x.key === tab ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${
              x.key === tab ? "border-accent font-medium text-accent" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {x.label}
          </Link>
        ))}
      </nav>

      {tab === "resumen" && (
        <>
          <Card className="mb-6">
            <CardTitle className="mb-4">Resumen</CardTitle>
            <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <Fact label="Plan comercial">
                {org.parent ? `Usa el de ${org.parent.name}` : org.planId ? (org.plan?.name ?? "—") : "A medida (sin plan)"}
              </Fact>
              <Fact label="Vigencia del plan">
                {org.parent
                  ? "La de la organización principal"
                  : !org.planId
                    ? "—"
                    : org.planEndsAt
                      ? `Hasta el ${planDateLabel(org.planEndsAt)} (${PLAN_STATE_LABEL[validity.state].toLowerCase()})`
                      : "Sin fecha de vencimiento"}
              </Fact>
              <Fact label="Solicitudes pendientes">
                {pendingRequests === 0 ? (
                  "Ninguna"
                ) : (
                  <Link href="/admin/solicitudes" className="text-accent hover:underline">
                    {pendingRequests} pendiente{pendingRequests === 1 ? "" : "s"}
                  </Link>
                )}
              </Fact>
              <Fact label="Estado">{org.suspended ? "Suspendida" : "Activa"}</Fact>
              <Fact label="Administradores">{formatSeatUsage(seats.admins, org.maxAdmins)}</Fact>
              <Fact label="Vendedores">{formatSeatUsage(seats.sellers, org.maxSellers)}</Fact>
              <Fact label="Inteligencia artificial">{AI_MODE_LABEL[aiMode] ?? aiMode}</Fact>
              <Fact label="Créditos de IA">
                {org.parent
                  ? "De la organización principal"
                  : credits
                    ? `${formatCredits(credits.balance.available)} disponibles de ${formatCredits(credits.balance.granted)} (${Math.floor(credits.balance.percentUsed)}% usado)`
                    : "Sin bolsa de créditos"}
              </Fact>
              <Fact label="Números de WhatsApp">
                {org.bots.length === 0
                  ? "Ninguno"
                  : `${connectedNumbers} conectado${connectedNumbers === 1 ? "" : "s"} de ${org.bots.length}`}
              </Fact>
              <Fact label="Jefe de Operaciones">{org.jefeEnabled ? "Habilitado" : "No habilitado"}</Fact>
              <Fact label="Suborganizaciones">{org.children.length === 0 ? "Ninguna" : String(org.children.length)}</Fact>
            </dl>
          </Card>

      <Card className="mb-6">
        <CardTitle className="mb-1">Organización principal</CardTitle>
        <p className="mb-4 text-sm text-ink-muted">
          Convierte esta organización en suborganización de otra (o vuelve a hacerla independiente). Solo hay un nivel.
        </p>
        <ParentForm
          orgId={org.id}
          currentParentId={org.parent?.id ?? null}
          currentParentName={org.parent?.name ?? null}
          eligibleParents={eligibleParents}
          hasChildren={org.children.length > 0}
          parentUsersInOrg={parentUsersInOrg}
        />
      </Card>

      {org.children.length > 0 && (
        <Card className="mb-6">
          <CardTitle className="mb-3">Suborganizaciones</CardTitle>
          <ul className="space-y-1 text-sm">
            {org.children.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/organizations/${c.id}`} className="text-accent hover:underline">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

        </>
      )}

      {tab === "plan" && (
        <>
      {!org.parent && (
        <Card className="mb-6">
          <CardTitle className="mb-1">Plan comercial</CardTitle>
          <p className="mb-4 text-sm text-ink-muted">
            Elige uno de tus planes (se crean en{" "}
            <Link href="/admin/planes" className="text-accent hover:underline">
              Planes
            </Link>
            ). Aplicarlo le pone a esta organización lo que incluye el plan. Si luego editas el plan, el cambio le llega solo y al
            dueño le sale un aviso.
          </p>
          <PlanAssignForm
            orgId={org.id}
            currentPlanId={org.planId}
            isCustom={planIsCustom}
            plans={plans.map((p) => ({
              id: p.id,
              name: p.name,
              priceLabel: formatPrice(p.price, p.currency),
              summary: describePlan(p.values).join(" · "),
            }))}
          />
          {org.planId && (
            <div className="mt-5">
              <PlanValidity
                orgId={org.id}
                state={validity.state}
                stateLabel={PLAN_STATE_LABEL[validity.state]}
                startedAtLabel={org.planStartedAt ? planDateLabel(org.planStartedAt) : null}
                endsAtLabel={org.planEndsAt ? planDateLabel(org.planEndsAt) : null}
                endsAtInput={org.planEndsAt ? org.planEndsAt.toISOString().slice(0, 10) : ""}
                daysText={validityDays}
              />
            </div>
          )}
        </Card>
      )}

      <Card className="mb-6">
        <CardTitle className="mb-1">Plan de la organización</CardTitle>
        <p className="mb-4 text-sm text-ink-muted">
          Qué puede hacer este cliente y hasta cuánto. Solo tú lo ves y lo cambias.
          {currentPlan ? ` Tiene el plan ${currentPlan.name}: si editas ese plan, estos valores se sobrescriben.` : ""}
        </p>
        <PlanForm
          orgId={org.id}
          plan={{
            canHaveSubOrgs: org.canHaveSubOrgs,
            maxSubOrgs: org.maxSubOrgs,
            maxAdmins: org.maxAdmins,
            maxSellers: org.maxSellers,
            canCustomizeBrand: org.canCustomizeBrand,
          }}
          usage={{ admins: seats.admins, sellers: seats.sellers, subOrgs }}
        />
      </Card>

      <Card className="mb-6">
        <CardTitle className="mb-1">Créditos de IA</CardTitle>
        <p className="mb-4 text-sm text-ink-muted">
          Bolsa mensual de créditos (1 crédito = US$ 0,001 de presupuesto de IA) compartida por todos los usuarios, más
          recargas que duran 90 días. Se cobran las funciones de IA que usan la clave de la plataforma y la transcripción
          de reuniones. Sin créditos por mes definidos, la organización no usa esta bolsa.
        </p>
        {org.parent ? (
          <p className="text-sm text-ink-muted">
            Es una suborganización: gasta de la bolsa de{" "}
            <Link href={`/admin/organizations/${org.parent.id}`} className="text-accent hover:underline">
              {org.parent.name}
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-6">
            <CreditsExplainer monthly={org.aiCreditsMonthly} />
            <CreditsPlanForm orgId={org.id} monthly={org.aiCreditsMonthly} users={seats.admins + seats.sellers} />
            {credits && creditSummary && (
              <>
                <hr className="border-border" />
                <AiCreditsPanel
                  credits={credits}
                  summary={creditSummary}
                  packs={creditPacks}
                  timeZone={org.timezone || "America/La_Paz"}
                  showRealCost
                  packAction={(p) => <CancelPackButton packId={p.id} />}
                />
                <hr className="border-border" />
                <div>
                  <h4 className="mb-2 text-sm font-medium text-ink">Recarga manual</h4>
                  <AddPackForm orgId={org.id} />
                </div>
              </>
            )}
          </div>
        )}
      </Card>

        </>
      )}

      {tab === "ia" && (
        <>
      <Card className="mb-6">
        <CardTitle className="mb-1">Inteligencia artificial</CardTitle>
        <p className="mb-4 text-sm text-ink-muted">
          De dónde sale la clave de OpenAI que usa esta organización para el bot, el asesor y los resúmenes.
          {org.parent ? " Las suborganizaciones usan la clave de su organización principal." : ""}
        </p>
        <AiForm
          orgId={org.id}
          mode={aiMode}
          customKeyLast4={org.customKeyLast4}
          budgetUsd={org.aiMonthlyBudgetUsd}
          tokenLimit={org.aiMonthlyTokenLimit}
          usageText={aiUsage ? describeMonthlyUsage(aiLimits, aiUsage) : null}
          limitReachedMessage={aiStatus && !aiStatus.ok ? aiStatus.message : null}
        />
      </Card>

        </>
      )}

      {tab === "conexiones" && (
        <>
      <Card className="mb-6">
        <CardTitle className="mb-4">Números de WhatsApp</CardTitle>
        {org.bots.length === 0 ? (
          <p className="text-sm text-ink-muted">Esta organización no tiene números conectados.</p>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>Nombre</Th>
                <Th>Estado</Th>
                <Th>WhatsApp</Th>
                <Th>Conversaciones</Th>
                <Th />
              </tr>
            </Thead>
            <tbody>
              {org.bots.map((bot) => (
                <Tr key={bot.id}>
                  <Td>{bot.name}</Td>
                  <Td>
                    <Badge tone={botStatusTone[bot.status]}>
                      <StatusDot tone={botStatusTone[bot.status]} />
                      {bot.status}
                    </Badge>
                  </Td>
                  <Td className="text-ink-muted">
                    {bot.whatsappConnection?.verified ? "Conectado" : "Sin conectar"}
                  </Td>
                  <Td className="">{bot._count.conversations}</Td>
                  <Td>
                    {bot.whatsappConnection && <DisconnectWhatsAppButton botId={bot.id} />}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <CardTitle>Jefe de Operaciones</CardTitle>
              <Badge tone={org.jefeEnabled ? "accent" : "neutral"}>
                {org.jefeEnabled ? "Habilitado" : "No habilitado"}
              </Badge>
            </div>
            <p className="text-sm text-ink-muted">
              API de integración, webhooks y tareas en la ficha del caso. Si está deshabilitado la organización no ve la
              sección en Integraciones, la API responde 403 y no salen eventos. No se borra nada: al habilitarlo de
              nuevo todo vuelve a funcionar.
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              {org.integrationKeys.length} clave{org.integrationKeys.length === 1 ? "" : "s"} activa
              {org.integrationKeys.length === 1 ? "" : "s"} ·{" "}
              {org.integrationWebhooks.length === 0
                ? "sin webhook"
                : org.integrationWebhooks[0].enabled
                  ? org.integrationWebhooks[0].lastError
                    ? "webhook activo con errores"
                    : "webhook activo"
                  : "webhook apagado"}
            </p>
          </div>
          <JefeToggle orgId={org.id} enabled={org.jefeEnabled} />
        </div>
      </Card>

        </>
      )}

      {tab === "usuarios" && (
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <CardTitle>Usuarios</CardTitle>
          <Link href="/admin/users" className="text-xs text-accent hover:underline">
            Gestionar usuarios
          </Link>
        </div>
        <Table>
          <Thead>
            <tr>
              <Th>Nombre</Th>
              <Th>Correo</Th>
              <Th>Rol</Th>
            </tr>
          </Thead>
          <tbody>
            {org.memberships.map((m) => (
              <Tr key={m.id}>
                <Td>{m.user.name ?? "—"}</Td>
                <Td className="text-ink-muted">{m.user.email}</Td>
                <Td>
                  <Badge tone={m.role === "OWNER" ? "accent" : "neutral"}>{m.role}</Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="font-medium text-ink">{children}</dd>
    </div>
  );
}
