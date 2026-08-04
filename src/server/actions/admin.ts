"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireSession, HttpError } from "@/server/auth/guards";
import type { ActionState } from "./types";

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
