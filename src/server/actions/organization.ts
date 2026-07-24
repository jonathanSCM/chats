"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import type { ActionState } from "./bots";

const renameSchema = z.object({ name: z.string().min(2, "Requerido").max(120) });

export async function renameOrganizationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    return { error: "Solo el dueño de la organización puede cambiar este dato" };
  }

  const parsed = renameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.organization.update({
    where: { id: session.user.organizationId },
    data: { name: parsed.data.name },
  });

  revalidatePath("/dashboard/organization");
  return { error: null, message: "Nombre actualizado." };
}
