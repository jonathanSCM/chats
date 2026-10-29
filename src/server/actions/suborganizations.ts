"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { createSubOrganization, setSubOrgSellers } from "@/server/services/suborganizations";
import type { ActionState } from "./types";

/** Solo el dueño de una organización de primer nivel (no de una hija) administra sus suborganizaciones. */
async function requireRootOwner() {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    return { ok: false, error: "Solo el dueño de la organización puede administrar suborganizaciones." } as const;
  }
  const org = await prisma.organization.findUnique({
    where: { id: session.user.organizationId },
    select: { id: true, parentId: true, canHaveSubOrgs: true },
  });
  if (!org) return { ok: false, error: "Organización no encontrada." } as const;
  if (org.parentId) return { ok: false, error: "Entra a la organización principal para administrar suborganizaciones." } as const;
  if (!org.canHaveSubOrgs) return { ok: false, error: "Tu plan no incluye suborganizaciones." } as const;
  return { ok: true, userId: session.user.id, parentId: org.id } as const;
}

export async function createSubOrganizationAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireRootOwner();
  if (!ctx.ok) return { error: ctx.error };

  const result = await createSubOrganization({
    parentId: ctx.parentId,
    name: String(formData.get("name") ?? ""),
    sellerIds: formData.getAll("sellerIds").map(String),
    createdByUserId: ctx.userId,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/dashboard/organization");
  return { error: null, message: "Suborganización creada. Ya puedes entrar a ella con el selector de organización." };
}

export async function setSubOrgSellersAction(childId: string, sellerIds: string[]): Promise<ActionState> {
  const ctx = await requireRootOwner();
  if (!ctx.ok) return { error: ctx.error };

  const result = await setSubOrgSellers({ parentId: ctx.parentId, childId, sellerIds, byUserId: ctx.userId });
  if (!result.ok) return { error: result.error };

  revalidatePath("/dashboard/organization");
  return { error: null, message: "Vendedores actualizados." };
}
