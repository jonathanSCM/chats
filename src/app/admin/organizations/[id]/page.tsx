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
import { changedKeys, describePlan, formatPriceSoles } from "@/lib/plans";
import { ParentForm } from "./_components/parent-form";
import { countParentUsersInOrg, listEligibleParents } from "@/server/services/org-hierarchy-admin";
import { getMonthUsage } from "@/server/services/ai/client";
import { checkMonthlyLimit, describeMonthlyUsage } from "@/lib/ai-limit";
import { parseAiMode } from "@/lib/ai-key";
import { getSeatCounts } from "@/server/services/org-limits";
import { getCreditUsageSummary, getOrgCredits, listCreditPacks } from "@/server/services/ai/credits";
import { AiCreditsPanel } from "@/components/ai-credits-panel";
import { AddPackForm, CancelPackButton, CreditsPlanForm } from "./_components/credits-admin";
import type { BotStatus } from "@/generated/prisma/enums";

const botStatusTone: Record<BotStatus, "accent" | "warning" | "neutral"> = {
  ACTIVE: "accent",
  PAUSED: "warning",
  DRAFT: "neutral",
};

export default async function AdminOrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, name: true } },
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
  const [eligibleParents, parentUsersInOrg] = await Promise.all([
    listEligibleParents(org.id),
    org.parent ? countParentUsersInOrg(org.id, org.parent.id) : Promise.resolve(0),
  ]);
  const aiMode = parseAiMode(org.aiMode);
  const plans = org.parent ? [] : await listPlans();
  const currentPlan = plans.find((p) => p.id === org.planId) ?? null;
  const planIsCustom = currentPlan ? changedKeys(currentPlan.values, planToValues(org)).length > 0 : false;
  const aiLimits = { budgetUsd: org.aiMonthlyBudgetUsd, tokens: org.aiMonthlyTokenLimit };
  const aiUsage = aiMode === "custom" ? await getMonthUsage(org.id) : null;
  const aiStatus = aiUsage ? checkMonthlyLimit(aiLimits, aiUsage) : null;
  // Créditos de IA: la bolsa es de la organización principal; una suborganización solo apunta a ella.
  const credits = org.parent ? null : await getOrgCredits(org.id);
  const [creditSummary, creditPacks] = credits ? await Promise.all([getCreditUsageSummary(org.id), listCreditPacks(org.id)]) : [null, []];

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
              priceLabel: formatPriceSoles(p.priceSoles),
              summary: describePlan(p.values).join(" · "),
            }))}
          />
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
    </div>
  );
}
