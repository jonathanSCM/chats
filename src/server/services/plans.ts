import { prisma } from "@/server/db/client";
import { audit } from "@/server/services/audit";
import { describePlan, normalizePlanValues, pickPlanValues, planChangeNotice, type PlanValues } from "@/lib/plans";
import { addMonths, planStatus, type PlanStatus } from "@/lib/plan-period";

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
  price: number | null;
  currency: string;
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
      data: { name: input.name, price: input.price, currency: input.currency, ...values },
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
    select: { ...ORG_PLAN_FIELDS, parentId: true, planId: true, planStartedAt: true, planEndsAt: true, plan: { select: { name: true } } },
  });
  if (!org) return { error: "Organización no encontrada." };
  if (org.parentId) return { error: "Una suborganización usa el plan de su organización principal." };
  if (org.planId === planId) return { notified: false };

  if (planId === null) {
    // Sin plan la organización queda "a medida": sin vencimiento.
    await prisma.organization.update({ where: { id: orgId }, data: { planId: null, planStartedAt: null, planEndsAt: null } });
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

  // La primera vez que se le da un plan empieza a correr hoy y vence en un mes (se puede cambiar). Si ya tenía fechas, se conservan.
  const now = new Date();
  const dates = org.planStartedAt && org.planEndsAt ? {} : { planStartedAt: now, planEndsAt: addMonths(now, 1) };
  await prisma.organization.update({
    where: { id: orgId },
    data: { planId, ...values, ...dates, ...(message ? { planNoticeMessage: message, planNoticeAt: now } : {}) },
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
  price: number | null;
  currency: string;
  values: PlanValues;
  organizations: { id: string; name: string; suspended: boolean }[];
}

export async function listPlans(): Promise<PlanSummary[]> {
  const plans = await prisma.plan.findMany({
    orderBy: [{ price: { sort: "asc", nulls: "last" } }, { name: "asc" }],
    include: { organizations: { select: { id: true, name: true, suspended: true }, orderBy: { name: "asc" } } },
  });
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price === null ? null : Number(p.price),
    currency: p.currency,
    values: planToValues(p),
    organizations: p.organizations,
  }));
}

const dateLabel = (d: Date) => d.toLocaleDateString("es", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Renueva el plan de una organización: el vencimiento se corre `months` meses (desde el vencimiento actual si todavía no
 * pasó, para no perder días ya pagados; desde hoy si ya venció). Al dueño le queda un aviso de que se renovó.
 */
export async function renewPlan(
  orgId: string,
  actorId: string | null,
  months = 1,
  now = new Date(),
): Promise<{ error: string } | { endsAt: Date }> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { parentId: true, planId: true, planStartedAt: true, planEndsAt: true, plan: { select: { name: true } } },
  });
  if (!org) return { error: "Organización no encontrada." };
  if (org.parentId) return { error: "Una suborganización usa el plan de su organización principal." };
  if (!org.planId) return { error: "Esta organización no tiene un plan: asígnale uno primero." };
  if (!Number.isInteger(months) || months < 1 || months > 36) return { error: "Los meses deben estar entre 1 y 36." };

  const base = org.planEndsAt && org.planEndsAt.getTime() > now.getTime() ? org.planEndsAt : now;
  const endsAt = addMonths(base, months);
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      planEndsAt: endsAt,
      planStartedAt: org.planStartedAt ?? now,
      planNoticeMessage: `Tu plan${org.plan ? ` "${org.plan.name}"` : ""} se renovó: ahora está activo hasta el ${dateLabel(endsAt)}.`,
      planNoticeAt: now,
    },
  });
  await audit({
    entityType: "Organization",
    entityId: orgId,
    action: "plan_renewed",
    userId: actorId,
    organizationId: orgId,
    before: { planEndsAt: org.planEndsAt?.toISOString() ?? null },
    after: { planEndsAt: endsAt.toISOString(), months },
  });
  return { endsAt };
}

/** Fija a mano hasta cuándo está activo el plan (por ejemplo para alinear con un pago). */
export async function setPlanEnd(orgId: string, endsAt: Date, actorId: string | null, now = new Date()): Promise<{ error: string } | { endsAt: Date }> {
  if (Number.isNaN(endsAt.getTime())) return { error: "Fecha inválida." };
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { parentId: true, planId: true, planStartedAt: true, planEndsAt: true },
  });
  if (!org) return { error: "Organización no encontrada." };
  if (org.parentId) return { error: "Una suborganización usa el plan de su organización principal." };
  if (!org.planId) return { error: "Esta organización no tiene un plan: asígnale uno primero." };
  await prisma.organization.update({
    where: { id: orgId },
    data: { planEndsAt: endsAt, planStartedAt: org.planStartedAt ?? now },
  });
  await audit({
    entityType: "Organization",
    entityId: orgId,
    action: "plan_end_set",
    userId: actorId,
    organizationId: orgId,
    before: { planEndsAt: org.planEndsAt?.toISOString() ?? null },
    after: { planEndsAt: endsAt.toISOString() },
  });
  return { endsAt };
}

export interface PlanOverview {
  planName: string;
  /** Si el plan es de la organización principal, su nombre. */
  fromParentName: string | null;
  status: PlanStatus;
  startedAt: Date | null;
  endsAt: Date | null;
  includes: string[];
}

/** Qué plan tiene una organización (el de su organización principal si es una suborganización), hasta cuándo y qué incluye. */
export async function getPlanOverview(organizationId: string, now = new Date()): Promise<PlanOverview | null> {
  const select = {
    name: true,
    planId: true,
    planStartedAt: true,
    planEndsAt: true,
    maxAdmins: true,
    maxSellers: true,
    canHaveSubOrgs: true,
    maxSubOrgs: true,
    canCustomizeBrand: true,
    aiCreditsMonthly: true,
    plan: { select: { name: true } },
  } as const;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { ...select, parent: { select } } });
  if (!org) return null;
  const root = org.parent ?? org;
  if (!root.planId || !root.plan) return null;
  return {
    planName: root.plan.name,
    fromParentName: org.parent ? org.parent.name : null,
    status: planStatus(root.planEndsAt, now),
    startedAt: root.planStartedAt,
    endsAt: root.planEndsAt,
    includes: describePlan(planToValues(root)),
  };
}
