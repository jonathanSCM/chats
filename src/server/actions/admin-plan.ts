"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession, HttpError } from "@/server/auth/guards";
import { audit } from "@/server/services/audit";
import type { ActionState } from "./types";

async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") {
    throw new HttpError(403, "Solo el superadmin puede hacer esto");
  }
  return session;
}

/** Vacío = sin tope (null); si no, un entero entre 0 y 100000. */
const limit = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : null),
  z
    .number()
    .int("Debe ser un número entero")
    .min(0, "No puede ser negativo")
    .max(100000, "Número demasiado grande")
    .nullable(),
);

const planSchema = z.object({
  canHaveSubOrgs: z.boolean(),
  maxSubOrgs: limit,
  maxAdmins: limit,
  maxSellers: limit,
  canCustomizeBrand: z.boolean(),
  aiOwnKeyEnabled: z.boolean(),
});

/**
 * El plan de una organización: qué puede hacer y hasta cuánto. Lo fija solo el superadmin.
 * Bajar un tope por debajo del uso actual NO saca a nadie: solo impide agregar más.
 */
export async function updateOrgPlanAction(
  orgId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSuperadmin();

  const parsed = planSchema.safeParse({
    canHaveSubOrgs: formData.get("canHaveSubOrgs") === "on",
    maxSubOrgs: formData.get("maxSubOrgs"),
    maxAdmins: formData.get("maxAdmins"),
    maxSellers: formData.get("maxSellers"),
    canCustomizeBrand: formData.get("canCustomizeBrand") === "on",
    aiOwnKeyEnabled: formData.get("aiOwnKeyEnabled") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const before = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      canHaveSubOrgs: true,
      maxSubOrgs: true,
      maxAdmins: true,
      maxSellers: true,
      canCustomizeBrand: true,
      aiOwnKeyEnabled: true,
    },
  });
  if (!before) return { error: "Organización no encontrada" };

  const data = parsed.data;
  await prisma.organization.update({
    where: { id: orgId },
    // Sin suborganizaciones habilitadas, el tope no tiene sentido: se limpia para no dejar un dato engañoso.
    data: { ...data, maxSubOrgs: data.canHaveSubOrgs ? data.maxSubOrgs : null },
  });

  await audit({
    entityType: "Organization",
    entityId: orgId,
    action: "plan_updated",
    userId: session.user.id,
    organizationId: orgId,
    before,
    after: data,
  });

  revalidatePath(`/admin/organizations/${orgId}`);
  revalidatePath("/dashboard/organization");
  return { error: null, message: "Plan guardado." };
}
