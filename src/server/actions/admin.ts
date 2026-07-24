"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession, HttpError } from "@/server/auth/guards";
import type { ActionState } from "./bots";

async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") {
    throw new HttpError(403, "Solo el superadmin puede hacer esto");
  }
  return session;
}

export async function toggleOrgSuspensionAction(
  orgId: string,
  suspended: boolean,
): Promise<ActionState> {
  await requireSuperadmin();

  await prisma.organization.update({ where: { id: orgId }, data: { suspended } });

  revalidatePath(`/admin/organizations/${orgId}`);
  revalidatePath("/admin");
  return { error: null };
}

const changePlanSchema = z.object({ planId: z.string().min(1) });

export async function adminChangeOrgPlanAction(
  orgId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSuperadmin();

  const parsed = changePlanSchema.safeParse({ planId: formData.get("planId") });
  if (!parsed.success) {
    return { error: "Selecciona un plan" };
  }

  const subscription = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
  if (!subscription) {
    return { error: "Esta organización no tiene suscripción" };
  }

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { planId: parsed.data.planId },
  });

  revalidatePath(`/admin/organizations/${orgId}`);
  return { error: null, message: "Plan actualizado." };
}

const grantSchema = z.object({
  quantity: z.coerce.number().int().positive("Debe ser un número positivo"),
});

export async function grantExtraConversationsAction(
  orgId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSuperadmin();

  const parsed = grantSchema.safeParse({ quantity: formData.get("quantity") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const subscription = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
  if (!subscription) {
    return { error: "Esta organización no tiene suscripción" };
  }

  await prisma.usageRecord.create({
    data: {
      subscriptionId: subscription.id,
      type: "EXTRA_PURCHASE",
      quantity: parsed.data.quantity,
      note: "Otorgado manualmente por un superadmin",
    },
  });

  revalidatePath(`/admin/organizations/${orgId}`);
  return { error: null, message: `Se otorgaron ${parsed.data.quantity} conversaciones extra.` };
}
