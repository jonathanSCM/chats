"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession, HttpError } from "@/server/auth/guards";
import { audit } from "@/server/services/audit";
import { assignPlanToOrg, planToValues, renewPlan, setPlanEnd, updatePlanAndPropagate } from "@/server/services/plans";
import { CURRENCIES } from "@/lib/plans";
import type { ActionState } from "./types";

async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") {
    throw new HttpError(403, "Solo el superadmin puede hacer esto");
  }
  return session;
}

/** Vacío = sin tope (null); si no, un entero entre 0 y el máximo. */
const limit = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[\s.]/g, "")) : null),
    z.number().int("Debe ser un número entero").min(0, "No puede ser negativo").max(max, "Número demasiado grande").nullable(),
  );

const price = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v.trim().replace(",", ".")) : null),
  z.number().min(0, "El precio no puede ser negativo").max(10_000_000, "Precio demasiado grande").nullable(),
);

const planSchema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre al plan").max(60, "El nombre es demasiado largo"),
  price,
  currency: z.enum(CURRENCIES.map((c) => c.code) as [string, ...string[]], { message: "Elige una moneda válida" }),
  maxAdmins: limit(100_000),
  maxSellers: limit(100_000),
  canHaveSubOrgs: z.boolean(),
  maxSubOrgs: limit(100_000),
  canCustomizeBrand: z.boolean(),
  aiCreditsMonthly: limit(100_000_000),
});

function parsePlan(formData: FormData) {
  const parsed = planSchema.safeParse({
    name: formData.get("name"),
    price: formData.get("price"),
    currency: formData.get("currency") || "PEN",
    maxAdmins: formData.get("maxAdmins"),
    maxSellers: formData.get("maxSellers"),
    canHaveSubOrgs: formData.get("canHaveSubOrgs") === "on",
    maxSubOrgs: formData.get("maxSubOrgs"),
    canCustomizeBrand: formData.get("canCustomizeBrand") === "on",
    aiCreditsMonthly: formData.get("aiCreditsMonthly"),
  });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const { name, price, currency, ...values } = parsed.data;
  return { ok: true as const, name, price, currency, values: planToValues(values) };
}

function revalidateAll() {
  revalidatePath("/admin/planes");
  revalidatePath("/admin/organizations", "layout");
  revalidatePath("/", "layout");
}

export async function createPlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSuperadmin();
  const parsed = parsePlan(formData);
  if (!parsed.ok) return { error: parsed.error };

  if (await prisma.plan.findUnique({ where: { name: parsed.name }, select: { id: true } })) {
    return { error: "Ya existe un plan con ese nombre." };
  }
  const plan = await prisma.plan.create({ data: { name: parsed.name, price: parsed.price, currency: parsed.currency, ...parsed.values } });
  await audit({
    entityType: "Plan",
    entityId: plan.id,
    action: "plan_created",
    userId: session.user.id,
    after: { name: parsed.name, price: parsed.price, currency: parsed.currency, ...parsed.values },
  });
  revalidateAll();
  return { error: null, message: `Plan "${parsed.name}" creado.` };
}

/** Edita un plan: el cambio se aplica a todas las organizaciones que lo tienen y a sus dueños les sale un aviso. */
export async function updatePlanAction(planId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSuperadmin();
  const parsed = parsePlan(formData);
  if (!parsed.ok) return { error: parsed.error };

  const existing = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } });
  if (!existing) return { error: "Plan no encontrado." };
  const sameName = await prisma.plan.findUnique({ where: { name: parsed.name }, select: { id: true } });
  if (sameName && sameName.id !== planId) return { error: "Ya existe otro plan con ese nombre." };

  const result = await updatePlanAndPropagate(planId, parsed, session.user.id);
  await audit({
    entityType: "Plan",
    entityId: planId,
    action: "plan_updated",
    userId: session.user.id,
    after: { name: parsed.name, price: parsed.price, currency: parsed.currency, ...parsed.values, ...result },
  });
  revalidateAll();
  const alcance =
    result.orgsUpdated === 0
      ? "Ninguna organización lo tiene todavía."
      : `Se aplicó a ${result.orgsUpdated} organización${result.orgsUpdated === 1 ? "" : "es"}` +
        (result.orgsNotified > 0 ? ` y se avisó a ${result.orgsNotified}.` : " (a ninguna le cambió nada, no se avisó).");
  return { error: null, message: `Plan guardado. ${alcance}` };
}

/** Borra un plan sin clientes. Con clientes hay que moverlos primero a otro plan. */
export async function deletePlanAction(planId: string): Promise<ActionState> {
  const session = await requireSuperadmin();
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: { _count: { select: { organizations: true } } } });
  if (!plan) return { error: "Plan no encontrado." };
  if (plan._count.organizations > 0) {
    return { error: `${plan._count.organizations} organización(es) tienen este plan. Cámbialas a otro plan antes de borrarlo.` };
  }
  await prisma.plan.delete({ where: { id: planId } });
  await audit({ entityType: "Plan", entityId: planId, action: "plan_deleted", userId: session.user.id, before: { name: plan.name } });
  revalidateAll();
  return { error: null, message: "Plan borrado." };
}

/** Asigna un plan a una organización (o "" = ninguno, a medida). */
export async function assignOrgPlanAction(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSuperadmin();
  const raw = String(formData.get("planId") ?? "");
  const result = await assignPlanToOrg(orgId, raw === "" ? null : raw, session.user.id);
  if ("error" in result) return { error: result.error };
  revalidatePath(`/admin/organizations/${orgId}`);
  revalidateAll();
  return {
    error: null,
    message:
      raw === ""
        ? "La organización quedó a medida (sin plan)."
        : result.notified
          ? "Plan aplicado. Se avisó al dueño del cambio."
          : "Plan aplicado.",
  };
}

/** El dueño cierra el aviso de cambio de plan. */
export async function dismissPlanNoticeAction(): Promise<ActionState> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  if (!orgId || session.user.role !== "OWNER") return { error: null };
  await prisma.organization.updateMany({
    where: { id: orgId, planNoticeAt: { not: null } },
    data: { planNoticeMessage: null, planNoticeAt: null },
  });
  revalidatePath("/", "layout");
  return { error: null };
}

/** Renueva el plan de una organización (suma meses al vencimiento) y le avisa al dueño. */
export async function renewOrgPlanAction(orgId: string, months: number): Promise<ActionState> {
  const session = await requireSuperadmin();
  const result = await renewPlan(orgId, session.user.id, months);
  if ("error" in result) return { error: result.error };
  revalidatePath(`/admin/organizations/${orgId}`);
  revalidateAll();
  return { error: null, message: "Plan renovado." };
}

/** Fija a mano hasta cuándo está activo el plan (fecha tipo 2026-12-31). */
export async function setOrgPlanEndAction(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSuperadmin();
  const raw = String(formData.get("endsAt") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: "Elige una fecha." };
  // Vence al final de ese día en UTC (23:59:59), para que "hasta el 31" incluya el 31 completo.
  const endsAt = new Date(`${raw}T23:59:59.000Z`);
  const result = await setPlanEnd(orgId, endsAt, session.user.id);
  if ("error" in result) return { error: result.error };
  revalidatePath(`/admin/organizations/${orgId}`);
  revalidateAll();
  return { error: null, message: "Vencimiento guardado." };
}
