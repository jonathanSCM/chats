"use server";

import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import type { ActionState } from "./types";

/**
 * El callback jwt de server/auth/index.ts vuelve a leer role/organizationId
 * desde la base en cada request (no solo al loguearse) -- por eso cambiar
 * de organización activa es tan simple como actualizar esas dos columnas:
 * el próximo request ya lo refleja solo, sin tocar NextAuth ni re-loguear.
 *
 * A propósito NO hace redirect() acá: varias pantallas (el dashboard es el
 * caso confirmado) piden parte de sus datos con un fetch() propio del
 * cliente que no se vuelve a disparar con una navegación "suave" del
 * router de Next a la misma URL en la que ya se estaba -- quedaba
 * mostrando la organización anterior hasta recargar a mano. Por eso
 * OrgSwitcher hace una recarga real del navegador (window.location) al
 * recibir éxito acá, no una navegación de Next -- eso sí garantiza que
 * cada pantalla, sin importar cómo pida sus datos, arranque de cero.
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

  return { error: null };
}
