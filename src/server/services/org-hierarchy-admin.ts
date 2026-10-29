import { prisma } from "@/server/db/client";
import { audit } from "@/server/services/audit";
import { ensureParentAdminsInChildren } from "@/server/services/suborganizations";
import { removeMembership } from "@/server/services/organization-membership";
import { getSeatPlan } from "@/server/services/org-limits";

/**
 * Lo que puede hacer el superadmin con la jerarquía: convertir una organización existente en
 * suborganización de otra, o volverla independiente. Un solo nivel: una hija no tiene hijas.
 * (Las suborganizaciones que crea el dueño de una organización principal van por `createSubOrganization`.)
 */

export type HierarchyResult = { ok: true; warnings: string[] } | { ok: false; error: string };

const NOT_A_PERSON = ["SUPERADMIN", "SYSTEM"] as const;

/** Organizaciones que pueden ser padre de `orgId`: de primer nivel, con suborganizaciones en su plan, y no ella misma. */
export async function listEligibleParents(orgId: string): Promise<{ id: string; name: string }[]> {
  return prisma.organization.findMany({
    where: { id: { not: orgId }, parentId: null, canHaveSubOrgs: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Cuántas personas del padre tienen hoy acceso a esta organización (las que perderían acceso al desvincular). */
export async function countParentUsersInOrg(orgId: string, parentId: string): Promise<number> {
  const parentMembers = await prisma.organizationMembership.findMany({
    where: { organizationId: parentId, user: { role: { notIn: [...NOT_A_PERSON] } } },
    select: { userId: true },
  });
  if (parentMembers.length === 0) return 0;
  return prisma.organizationMembership.count({
    where: { organizationId: orgId, userId: { in: parentMembers.map((m) => m.userId) } },
  });
}

export async function attachToParent(params: { orgId: string; parentId: string; byUserId: string }): Promise<HierarchyResult> {
  if (params.orgId === params.parentId) return { ok: false, error: "Una organización no puede ser padre de sí misma." };

  const [org, parent, childCount] = await Promise.all([
    prisma.organization.findUnique({ where: { id: params.orgId }, select: { id: true, name: true, parentId: true } }),
    prisma.organization.findUnique({
      where: { id: params.parentId },
      select: { id: true, name: true, parentId: true, canHaveSubOrgs: true, maxSubOrgs: true },
    }),
    prisma.organization.count({ where: { parentId: params.orgId } }),
  ]);
  if (!org || !parent) return { ok: false, error: "Organización no encontrada." };
  if (org.parentId === parent.id) return { ok: false, error: `Ya es suborganización de ${parent.name}.` };
  if (parent.parentId) return { ok: false, error: `${parent.name} ya es una suborganización: solo hay un nivel.` };
  if (childCount > 0) {
    return { ok: false, error: "Esta organización ya tiene suborganizaciones propias. Desvincúlalas primero: solo hay un nivel." };
  }
  if (!parent.canHaveSubOrgs) {
    return { ok: false, error: `El plan de ${parent.name} no incluye suborganizaciones. Actívalas primero en su plan.` };
  }

  const warnings: string[] = [];
  const existingChildren = await prisma.organization.count({ where: { parentId: parent.id } });
  if (parent.maxSubOrgs !== null && existingChildren + 1 > parent.maxSubOrgs) {
    warnings.push(`${parent.name} queda con ${existingChildren + 1} suborganizaciones y su plan permite ${parent.maxSubOrgs}.`);
  }

  await prisma.organization.update({
    where: { id: org.id },
    // Una hija no puede tener hijas: se apagan esas opciones para no dejar un dato engañoso.
    data: { parentId: parent.id, canHaveSubOrgs: false, maxSubOrgs: null },
  });
  // Los administradores del padre entran como administradores a la nueva hija.
  await ensureParentAdminsInChildren(parent.id);

  const plan = await getSeatPlan(org.id);
  const { admins, sellers } = plan.counts;
  if (plan.limits.maxAdmins !== null && admins > plan.limits.maxAdmins) {
    warnings.push(`El grupo queda con ${admins} administradores y el plan de ${parent.name} permite ${plan.limits.maxAdmins}.`);
  }
  if (plan.limits.maxSellers !== null && sellers > plan.limits.maxSellers) {
    warnings.push(`El grupo queda con ${sellers} vendedores y el plan de ${parent.name} permite ${plan.limits.maxSellers}.`);
  }

  await audit({
    entityType: "Organization",
    entityId: org.id,
    action: "org_attached_to_parent",
    userId: params.byUserId,
    organizationId: org.id,
    before: { parentId: org.parentId },
    after: { parentId: parent.id, warnings },
  });
  return { ok: true, warnings };
}

export async function detachFromParent(params: {
  orgId: string;
  removeParentUsers: boolean;
  byUserId: string;
}): Promise<HierarchyResult> {
  const org = await prisma.organization.findUnique({ where: { id: params.orgId }, select: { id: true, parentId: true } });
  if (!org) return { ok: false, error: "Organización no encontrada." };
  if (!org.parentId) return { ok: false, error: "Esta organización no tiene organización padre." };
  const parentId = org.parentId;

  let toRemove: string[] = [];
  if (params.removeParentUsers) {
    const parentMembers = await prisma.organizationMembership.findMany({
      where: { organizationId: parentId, user: { role: { notIn: [...NOT_A_PERSON] } } },
      select: { userId: true },
    });
    const inChild = await prisma.organizationMembership.findMany({
      where: { organizationId: org.id, userId: { in: parentMembers.map((m) => m.userId) } },
      select: { userId: true },
    });
    toRemove = inChild.map((m) => m.userId);

    // No dejar la organización sin ningún administrador propio.
    const owners = await prisma.organizationMembership.findMany({
      where: { organizationId: org.id, role: "OWNER", user: { role: { notIn: [...NOT_A_PERSON] } } },
      select: { userId: true },
    });
    const remainingOwners = owners.filter((o) => !toRemove.includes(o.userId));
    if (toRemove.length > 0 && remainingOwners.length === 0) {
      return {
        ok: false,
        error:
          "Quitar a los usuarios del padre dejaría a esta organización sin administradores. Agrégale primero un administrador propio (o desmarca la casilla y quítalos luego a mano).",
      };
    }
  }

  await prisma.organization.update({ where: { id: org.id }, data: { parentId: null } });
  for (const userId of toRemove) await removeMembership(userId, org.id);

  await audit({
    entityType: "Organization",
    entityId: org.id,
    action: "org_detached_from_parent",
    userId: params.byUserId,
    organizationId: org.id,
    before: { parentId },
    after: { parentId: null, usersRemoved: toRemove.length },
  });
  return { ok: true, warnings: toRemove.length > 0 ? [`Se quitó el acceso a ${toRemove.length} persona${toRemove.length === 1 ? "" : "s"} de la organización padre.`] : [] };
}
