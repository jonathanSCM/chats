import { prisma } from "@/server/db/client";
import { uniqueOrgSlug } from "@/lib/slugify";
import { DEFAULT_PIPELINE_STAGES, DEFAULT_SERVICES } from "@/lib/pipeline";
import { removeMembership } from "@/server/services/organization-membership";
import { audit } from "@/server/services/audit";

/**
 * Suborganizaciones: una organización padre (con `canHaveSubOrgs` en su plan) crea organizaciones
 * hijas, totalmente aisladas (sus propios chats, contactos, bots y claves de WhatsApp). Un solo
 * nivel: una hija no puede tener hijas. Los administradores del padre entran a todas sus hijas; los
 * vendedores se asignan una por una. Los topes de usuarios del padre se comparten (ver org-limits).
 */

export type ServiceResult<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_A_PERSON = ["SUPERADMIN", "SYSTEM"] as const;

/** Vendedores (MEMBER) del padre, para elegir cuáles usa cada hija. */
export async function listParentSellers(parentId: string): Promise<{ id: string; name: string | null; email: string }[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: { organizationId: parentId, role: "MEMBER", user: { role: { notIn: [...NOT_A_PERSON] } } },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.user);
}

/** Las hijas de una organización, con los vendedores asignados a cada una. */
export async function listSubOrganizations(parentId: string) {
  const children = await prisma.organization.findMany({
    where: { parentId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      memberships: {
        where: { role: "MEMBER", user: { role: { notIn: [...NOT_A_PERSON] } } },
        select: { userId: true },
      },
    },
  });
  return children.map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, sellerIds: c.memberships.map((m) => m.userId) }));
}

/** Administradores (OWNER) del padre entran como administradores a todas sus hijas (sin ocupar lugar extra: ya son del grupo). */
export async function ensureParentAdminsInChildren(parentId: string): Promise<void> {
  const [admins, children] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { organizationId: parentId, role: "OWNER", user: { role: { notIn: [...NOT_A_PERSON] } } },
      select: { userId: true },
    }),
    prisma.organization.findMany({ where: { parentId }, select: { id: true } }),
  ]);
  if (admins.length === 0 || children.length === 0) return;
  await prisma.organizationMembership.createMany({
    data: children.flatMap((c) => admins.map((a) => ({ userId: a.userId, organizationId: c.id, role: "OWNER" as const }))),
    skipDuplicates: true,
  });
}

async function loadRootForSubOrgs(parentId: string) {
  return prisma.organization.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      name: true,
      parentId: true,
      canHaveSubOrgs: true,
      maxSubOrgs: true,
      timezone: true,
      bookingDays: true,
      bookingStartHour: true,
      bookingEndHour: true,
      bookingDurationMinutes: true,
      bookingLeadHours: true,
    },
  });
}

export async function createSubOrganization(params: {
  parentId: string;
  name: string;
  sellerIds: string[];
  createdByUserId: string;
}): Promise<ServiceResult<{ id: string }>> {
  const name = params.name.trim();
  if (name.length < 2 || name.length > 120) return { ok: false, error: "El nombre debe tener entre 2 y 120 caracteres." };

  const parent = await loadRootForSubOrgs(params.parentId);
  if (!parent) return { ok: false, error: "Organización no encontrada." };
  if (parent.parentId) return { ok: false, error: "Una suborganización no puede tener suborganizaciones." };
  if (!parent.canHaveSubOrgs) return { ok: false, error: "Tu plan no incluye suborganizaciones." };

  if (parent.maxSubOrgs !== null) {
    const existing = await prisma.organization.count({ where: { parentId: parent.id } });
    if (existing >= parent.maxSubOrgs) {
      return {
        ok: false,
        error: `Tu plan permite ${parent.maxSubOrgs} ${parent.maxSubOrgs === 1 ? "suborganización" : "suborganizaciones"} y ya tienes ${existing}.`,
      };
    }
  }

  // Solo se puede elegir entre los vendedores del padre: así nadie ajeno entra por esta puerta ni ocupa un lugar nuevo.
  const sellerIds = [...new Set(params.sellerIds)];
  if (sellerIds.length > 0) {
    const valid = await prisma.organizationMembership.count({
      where: { organizationId: parent.id, role: "MEMBER", userId: { in: sellerIds }, user: { role: { notIn: [...NOT_A_PERSON] } } },
    });
    if (valid !== sellerIds.length) return { ok: false, error: "Hay vendedores que no pertenecen a tu organización." };
  }

  const [stages, services, admins] = await Promise.all([
    prisma.pipelineStage.findMany({ where: { organizationId: parent.id }, orderBy: { order: "asc" } }),
    prisma.service.findMany({ where: { organizationId: parent.id }, orderBy: { order: "asc" } }),
    prisma.organizationMembership.findMany({
      where: { organizationId: parent.id, role: "OWNER", user: { role: { notIn: [...NOT_A_PERSON] } } },
      select: { userId: true },
    }),
  ]);
  const slug = await uniqueOrgSlug(name);

  const child = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: {
        name,
        slug,
        parentId: parent.id,
        timezone: parent.timezone,
        bookingDays: parent.bookingDays,
        bookingStartHour: parent.bookingStartHour,
        bookingEndHour: parent.bookingEndHour,
        bookingDurationMinutes: parent.bookingDurationMinutes,
        bookingLeadHours: parent.bookingLeadHours,
      },
    });

    // Mismo embudo y servicios que el padre (o los de siempre si el padre aún no los configuró).
    await tx.pipelineStage.createMany({
      data: (stages.length > 0
        ? stages.map((s) => ({
            label: s.label,
            color: s.color,
            criteria: s.criteria,
            order: s.order,
            role: s.role,
            isDefaultEntry: s.isDefaultEntry,
            requiresProposalFields: s.requiresProposalFields,
          }))
        : DEFAULT_PIPELINE_STAGES.map((s) => ({
            label: s.label,
            color: s.color,
            criteria: s.criteria,
            order: s.order,
            role: s.role,
            isDefaultEntry: s.isDefaultEntry,
            requiresProposalFields: s.requiresProposalFields,
          }))
      ).map((s) => ({ ...s, organizationId: created.id })),
    });
    await tx.service.createMany({
      data: (services.length > 0 ? services.map((s) => s.label) : DEFAULT_SERVICES).map((label, order) => ({
        organizationId: created.id,
        label,
        order,
      })),
    });

    const adminIds = new Set([...admins.map((a) => a.userId), params.createdByUserId]);
    await tx.organizationMembership.createMany({
      data: [
        ...[...adminIds].map((userId) => ({ userId, organizationId: created.id, role: "OWNER" as const })),
        ...sellerIds.filter((id) => !adminIds.has(id)).map((userId) => ({ userId, organizationId: created.id, role: "MEMBER" as const })),
      ],
      skipDuplicates: true,
    });
    return created;
  });

  await audit({
    entityType: "Organization",
    entityId: child.id,
    action: "suborg_created",
    userId: params.createdByUserId,
    organizationId: parent.id,
    after: { name, parentId: parent.id, sellers: sellerIds.length },
  });
  return { ok: true, id: child.id };
}

/**
 * Deja exactamente `sellerIds` como los vendedores de la suborganización (agrega los que faltan y
 * saca los que sobran). Los administradores del padre no se tocan. Solo se pueden elegir vendedores
 * del padre.
 */
export async function setSubOrgSellers(params: {
  parentId: string;
  childId: string;
  sellerIds: string[];
  byUserId: string;
}): Promise<ServiceResult<{ added: number; removed: number }>> {
  const child = await prisma.organization.findUnique({ where: { id: params.childId }, select: { id: true, parentId: true } });
  if (!child || child.parentId !== params.parentId) return { ok: false, error: "Suborganización no encontrada." };

  const wanted = [...new Set(params.sellerIds)];
  if (wanted.length > 0) {
    const valid = await prisma.organizationMembership.count({
      where: { organizationId: params.parentId, role: "MEMBER", userId: { in: wanted }, user: { role: { notIn: [...NOT_A_PERSON] } } },
    });
    if (valid !== wanted.length) return { ok: false, error: "Hay vendedores que no pertenecen a tu organización." };
  }

  const current = await prisma.organizationMembership.findMany({
    where: { organizationId: child.id, role: "MEMBER", user: { role: { notIn: [...NOT_A_PERSON] } } },
    select: { userId: true },
  });
  const currentIds = new Set(current.map((c) => c.userId));
  const toAdd = wanted.filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !wanted.includes(id));

  if (toAdd.length > 0) {
    // Si alguien ya es administrador de la hija no se le baja el rol: skipDuplicates respeta lo que ya tiene.
    await prisma.organizationMembership.createMany({
      data: toAdd.map((userId) => ({ userId, organizationId: child.id, role: "MEMBER" as const })),
      skipDuplicates: true,
    });
    // Quien no tenía organización activa pasa a tener esta.
    const noActive = await prisma.user.findMany({ where: { id: { in: toAdd }, organizationId: null }, select: { id: true } });
    for (const u of noActive) {
      await prisma.user.update({ where: { id: u.id }, data: { organizationId: child.id, role: "MEMBER" } });
    }
  }
  for (const userId of toRemove) await removeMembership(userId, child.id);

  await audit({
    entityType: "Organization",
    entityId: child.id,
    action: "suborg_sellers_updated",
    userId: params.byUserId,
    organizationId: params.parentId,
    after: { added: toAdd.length, removed: toRemove.length, total: wanted.length },
  });
  return { ok: true, added: toAdd.length, removed: toRemove.length };
}

/**
 * Mantiene al día las hijas cuando cambia el rol de alguien en el padre: si pasa a ser
 * administrador entra como administrador a todas las hijas; si deja de serlo pierde el acceso de
 * administrador a ellas (puede volver como vendedor si se le asigna). Sin hijas no hace nada.
 */
export async function syncChildrenForMember(parentId: string, userId: string, role: "OWNER" | "MEMBER"): Promise<void> {
  const children = await prisma.organization.findMany({ where: { parentId }, select: { id: true } });
  if (children.length === 0) return;
  if (role === "OWNER") {
    await ensureParentAdminsInChildren(parentId);
    return;
  }
  for (const child of children) {
    const m = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId: child.id } },
      select: { role: true },
    });
    if (m?.role === "OWNER") await removeMembership(userId, child.id);
  }
}
