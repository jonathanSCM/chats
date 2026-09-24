import { prisma } from "@/server/db/client";

/**
 * Ids de todos los usuarios que pertenecen a esta organización (tengan o no
 * esta organización como la activa ahora mismo). Reemplaza al viejo
 * `where: { organizationId }` directo sobre User en los lugares que listan
 * "el equipo" -- ese filtro solo veía a quien tuviera la organización
 * activa en este momento, no a todos sus miembros reales.
 */
export async function getOrgMemberUserIds(organizationId: string): Promise<string[]> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId },
    select: { userId: true },
  });
  return memberships.map((m) => m.userId);
}

/** Todas las organizaciones a las que pertenece un usuario, para el selector. */
export async function getUserMemberships(
  userId: string,
): Promise<{ organizationId: string; organizationName: string; role: string }[]> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId },
    include: { organization: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    organizationId: m.organizationId,
    organizationName: m.organization.name,
    role: m.role,
  }));
}
