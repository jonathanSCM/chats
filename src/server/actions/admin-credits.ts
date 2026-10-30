"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireSession, HttpError } from "@/server/auth/guards";
import { PACK_VALID_DAYS } from "@/lib/ai-credits";
import { addCreditPack } from "@/server/services/ai/credits";
import { audit } from "@/server/services/audit";
import type { ActionState } from "./types";

const MAX_CREDITS = 100_000_000;

async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") {
    throw new HttpError(403, "Solo el superadmin puede hacer esto");
  }
  return session;
}

function parseWhole(raw: FormDataEntryValue | null, label: string): { value: number | null } | { error: string } {
  const text = typeof raw === "string" ? raw.trim().replace(/[\s.]/g, "") : "";
  if (text === "") return { value: null };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) return { error: `${label}: debe ser un número entero igual o mayor que 0.` };
  if (n > MAX_CREDITS) return { error: `${label}: número demasiado grande.` };
  return { value: n };
}

/** Créditos de IA incluidos por mes en el plan. Vacío = esta organización no usa créditos (IA sin esta bolsa). */
export async function updateOrgCreditsPlanAction(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSuperadmin();
  const monthly = parseWhole(formData.get("aiCreditsMonthly"), "Créditos por mes");
  if ("error" in monthly) return { error: monthly.error };

  const before = await prisma.organization.findUnique({ where: { id: orgId }, select: { aiCreditsMonthly: true, parentId: true } });
  if (!before) return { error: "Organización no encontrada." };
  if (before.parentId) {
    return { error: "Esta es una suborganización: usa la bolsa de créditos de su organización principal." };
  }

  await prisma.organization.update({ where: { id: orgId }, data: { aiCreditsMonthly: monthly.value } });
  await audit({
    entityType: "Organization",
    entityId: orgId,
    action: "ai_credits_plan_updated",
    userId: session.user.id,
    organizationId: orgId,
    before: { aiCreditsMonthly: before.aiCreditsMonthly },
    after: { aiCreditsMonthly: monthly.value },
  });

  revalidatePath(`/admin/organizations/${orgId}`);
  revalidatePath("/", "layout");
  return { error: null, message: monthly.value === null ? "Sin créditos: la IA de esta organización ya no usa bolsa." : "Plan de créditos guardado." };
}

/** Recarga manual: un paquete de créditos adicionales que dura 90 días (o los que se indiquen). */
export async function addCreditPackAction(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSuperadmin();
  const credits = parseWhole(formData.get("credits"), "Créditos");
  if ("error" in credits) return { error: credits.error };
  if (!credits.value || credits.value <= 0) return { error: "Indica cuántos créditos se recargan." };

  const days = parseWhole(formData.get("days"), "Días de vigencia");
  if ("error" in days) return { error: days.error };
  const validDays = days.value ?? PACK_VALID_DAYS;
  if (validDays < 1 || validDays > 3650) return { error: "Los días de vigencia deben estar entre 1 y 3650." };

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { parentId: true, aiCreditsMonthly: true } });
  if (!org) return { error: "Organización no encontrada." };
  if (org.parentId) return { error: "Esta es una suborganización: la recarga se hace en su organización principal." };
  if (org.aiCreditsMonthly === null) {
    return { error: "Primero define los créditos por mes del plan: sin eso la organización no usa créditos." };
  }

  const note = String(formData.get("note") ?? "").trim().slice(0, 200) || null;
  const pack = await addCreditPack({ organizationId: orgId, credits: credits.value, days: validDays, note, createdById: session.user.id });
  await audit({
    entityType: "Organization",
    entityId: orgId,
    action: "ai_credits_pack_added",
    userId: session.user.id,
    organizationId: orgId,
    after: { packId: pack.id, credits: credits.value, days: validDays, note },
  });

  revalidatePath(`/admin/organizations/${orgId}`);
  revalidatePath("/", "layout");
  return { error: null, message: `Se agregaron ${credits.value.toLocaleString("es")} créditos.` };
}

/** Anula un paquete cargado por error: deja su saldo en 0 (el consumo ya hecho queda en el registro). */
export async function cancelCreditPackAction(packId: string): Promise<ActionState> {
  const session = await requireSuperadmin();
  const pack = await prisma.aiCreditPack.findUnique({ where: { id: packId } });
  if (!pack) return { error: "Paquete no encontrado." };

  await prisma.aiCreditPack.update({ where: { id: packId }, data: { remaining: 0 } });
  await audit({
    entityType: "Organization",
    entityId: pack.organizationId,
    action: "ai_credits_pack_canceled",
    userId: session.user.id,
    organizationId: pack.organizationId,
    before: { packId, credits: pack.credits, remaining: pack.remaining },
  });

  revalidatePath(`/admin/organizations/${pack.organizationId}`);
  revalidatePath("/", "layout");
  return { error: null, message: "Paquete anulado." };
}
