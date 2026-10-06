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

/**
 * Saca a un usuario de una organización. Si esa era su organización ACTIVA,
 * no puede quedar apuntando a una de la que ya no es miembro: pasa a otra
 * que le quede, o queda sin organización (organizationId null).
 */
export async function removeMembership(userId: string, organizationId: string): Promise<boolean> {
  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  if (!membership) return false;

  await prisma.organizationMembership.delete({ where: { id: membership.id } });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  if (user?.organizationId === organizationId) {
    const another = await prisma.organizationMembership.findFirst({ where: { userId } });
    await prisma.user.update({
      where: { id: userId },
      data: another ? { organizationId: another.organizationId, role: another.role } : { organizationId: null },
    });
  }
  return true;
}

/** Mete a un usuario en una organización (o le cambia el rol si ya estaba). Si no tenía ninguna activa, esta pasa a serlo. */
export async function addMembership(userId: string, organizationId: string, role: "OWNER" | "MEMBER"): Promise<void> {
  await prisma.organizationMembership.upsert({
    where: { userId_organizationId: { userId, organizationId } },
    create: { userId, organizationId, role },
    update: { role },
  });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  if (!user?.organizationId) {
    await prisma.user.update({ where: { id: userId }, data: { organizationId, role } });
  } else if (user.organizationId === organizationId) {
    await prisma.user.update({ where: { id: userId }, data: { role } });
  }
}
