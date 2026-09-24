"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import type { ActionState } from "./types";

/**
 * El callback jwt de server/auth/index.ts vuelve a leer role/organizationId
 * desde la base en cada request (no solo al loguearse) -- por eso cambiar
 * de organización activa es tan simple como actualizar esas dos columnas:
 * el próximo request ya lo refleja solo, sin tocar NextAuth ni re-loguear.
 */
export async function switchOrganizationAction(organizationId: string): Promise<ActionState> {
  const session = await requireSession();

  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: session.user.id, organizationId } },
  });
  if (!membership) return { error: "No pertenecés a esa organización" };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { organizationId, role: membership.role },
  });

  redirect("/dashboard");
}
