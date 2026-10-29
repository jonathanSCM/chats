"use server";

import { revalidatePath } from "next/cache";
import { requireSession, HttpError } from "@/server/auth/guards";
import { attachToParent, detachFromParent } from "@/server/services/org-hierarchy-admin";
import type { ActionState } from "./types";

async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") {
    throw new HttpError(403, "Solo el superadmin puede hacer esto");
  }
  return session;
}

/**
 * Convierte la organización en suborganización de la elegida, o la vuelve independiente si no se elige
 * ninguna. Solo el superadmin. Al desvincular, la casilla `removeParentUsers` quita el acceso de las
 * personas que venían del padre.
 */
export async function setOrgParentAction(orgId: string, _prevState: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSuperadmin();

  const parentId = String(formData.get("parentId") ?? "").trim();
  const result = parentId
    ? await attachToParent({ orgId, parentId, byUserId: session.user.id })
    : await detachFromParent({ orgId, removeParentUsers: formData.get("removeParentUsers") === "on", byUserId: session.user.id });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/admin/organizations/${orgId}`);
  revalidatePath("/admin");
  revalidatePath("/", "layout");
  const base = parentId ? "Listo: ahora es una suborganización." : "Listo: ahora es una organización independiente.";
  return { error: null, message: [base, ...result.warnings].join(" ") };
}
