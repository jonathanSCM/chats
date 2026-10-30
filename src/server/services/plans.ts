import { prisma } from "@/server/db/client";
import { audit } from "@/server/services/audit";
import { normalizePlanValues, pickPlanValues, planChangeNotice, type PlanValues } from "@/lib/plans";

const ORG_PLAN_FIELDS = {
  id: true,
  maxAdmins: true,
  maxSellers: true,
  canHaveSubOrgs: true,
  maxSubOrgs: true,
  canCustomizeBrand: true,
  aiCreditsMonthly: true,
} as const;

export interface PlanInput {
  name: string;
  priceSoles: number | null;
  values: PlanValues;
}

export function planToValues(plan: PlanValues): PlanValues {
  return normalizePlanValues(pickPlanValues(plan));
}

/**
 * Edita un plan y lo aplica a TODAS las organizaciones que lo tienen. A cada dueño le queda un aviso
 * emergente con lo que cambió en SU organización (si a esa organización no le cambia nada, no se le avisa).
 * Bajar un tope por debajo del uso actual no saca a nadie: solo impide agregar más.
 */
export async function updatePlanAndPropagate(
  planId: string,
  input: PlanInput,
  actorId: string,
): Promise<{ orgsUpdated: number; orgsNotified: number }> {
  const values = planToValues(input.values);
  const orgs = await prisma.organization.findMany({ where: { planId }, select: ORG_PLAN_FIELDS });

  const noticed: { id: string; message: string }[] = [];
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.plan.update({
      where: { id: planId },
      data: { name: input.name, priceSoles: input.priceSoles, ...values },
    });
    for (const org of orgs) {
      const message = planChangeNotice({ planName: input.name, before: planToValues(org), after: values });
      await tx.organization.update({
        where: { id: org.id },
        data: { ...values, ...(message ? { planNoticeMessage: message, planNoticeAt: now } : {}) },
      });
      if (message) noticed.push({ id: org.id, message });
    }
  });

  for (const org of orgs) {
    await audit({
      entityType: "Organization",
      entityId: org.id,
      action: "plan_propagated",
      userId: actorId,
      organizationId: org.id,
      before: planToValues(org),
      after: { planId, ...values },
    });
  }
  return { orgsUpdated: orgs.length, orgsNotified: noticed.length };
}

/**
 * Asigna un plan a una organización (o se lo quita con null: queda "a medida" con los valores que tenía).
 * Si ya tenía otro plan, o el plan le cambia algo, el dueño recibe un aviso emergente.
 */
export async function assignPlanToOrg(orgId: string, planId: string | null, actorId: string): Promise<{ error: string } | { notified: boolean }> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { ...ORG_PLAN_FIELDS, parentId: true, planId: true, plan: { select: { name: true } } },
  });
  if (!org) return { error: "Organización no encontrada." };
  if (org.parentId) return { error: "Una suborganización usa el plan de su organización principal." };
  if (org.planId === planId) return { notified: false };

  if (planId === null) {
    await prisma.organization.update({ where: { id: orgId }, data: { planId: null } });
    await audit({
      entityType: "Organization",
      entityId: orgId,
      action: "plan_unassigned",
      userId: actorId,
      organizationId: orgId,
      before: { planId: org.planId },
      after: { planId: null },
    });
    return { notified: false };
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) return { error: "Plan no encontrado." };
  const values = planToValues(plan);

  // Con un plan anterior siempre se avisa del cambio; la primera asignación es el alta del cliente y no necesita aviso.
  const message = org.planId
    ? planChangeNotice({ planName: plan.name, before: planToValues(org), after: values, previousPlanName: org.plan?.name ?? null })
    : null;

  await prisma.organization.update({
    where: { id: orgId },
    data: { planId, ...values, ...(message ? { planNoticeMessage: message, planNoticeAt: new Date() } : {}) },
  });
  await audit({
    entityType: "Organization",
    entityId: orgId,
    action: "plan_assigned",
    userId: actorId,
    organizationId: orgId,
    before: { planId: org.planId, ...planToValues(org) },
    after: { planId, ...values },
  });
  return { notified: Boolean(message) };
}

export interface PlanSummary {
  id: string;
  name: string;
  priceSoles: number | null;
  values: PlanValues;
  organizations: { id: string; name: string; suspended: boolean }[];
}

export async function listPlans(): Promise<PlanSummary[]> {
  const plans = await prisma.plan.findMany({
    orderBy: [{ priceSoles: { sort: "asc", nulls: "last" } }, { name: "asc" }],
    include: { organizations: { select: { id: true, name: true, suspended: true }, orderBy: { name: "asc" } } },
  });
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    priceSoles: p.priceSoles === null ? null : Number(p.priceSoles),
    values: planToValues(p),
    organizations: p.organizations,
  }));
}
