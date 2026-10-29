// Prueba de integración de las suborganizaciones contra la BASE LOCAL (no toca nada de producción).
// Crea datos temporales y los borra al final.   Uso:  npx tsx --env-file=.env scripts/test-suborgs.ts
import { prisma } from "@/server/db/client";
import {
  createSubOrganization,
  ensureParentAdminsInChildren,
  listSubOrganizations,
  setSubOrgSellers,
  syncChildrenForMember,
} from "@/server/services/suborganizations";
import { getSeatCounts, getSeatPlan, seatBlockedMessage } from "@/server/services/org-limits";
import { removeMembership } from "@/server/services/organization-membership";
import { resolveOrgBrand } from "@/lib/brand";

const tag = `suborg-${Date.now()}`;
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(ok ? "  OK " : "  FALLA", name, detail);
};

async function main() {
  const parent = await prisma.organization.create({
    data: {
      name: `Matriz ${tag}`,
      slug: tag,
      canHaveSubOrgs: true,
      maxSubOrgs: 2,
      maxAdmins: 2,
      maxSellers: 3,
      canCustomizeBrand: true,
      brandName: "Matriz Financiera",
      brandColor: "#1d4ed8",
    },
  });
  try {
  const mk = (n: string, role: "OWNER" | "MEMBER" = "MEMBER") =>
    prisma.user.create({ data: { email: `${n}-${tag}@test.dev`, name: n, passwordHash: "x", role, organizationId: parent.id } });
  const [admin, admin2, s1, s2, s3, outsider] = await Promise.all([mk("admin", "OWNER"), mk("admin2", "OWNER"), mk("s1"), mk("s2"), mk("s3"), mk("fuera")]);
  for (const [u, role] of [[admin, "OWNER"], [admin2, "OWNER"], [s1, "MEMBER"], [s2, "MEMBER"], [s3, "MEMBER"]] as const) {
    await prisma.organizationMembership.create({ data: { userId: u.id, organizationId: parent.id, role } });
  }
  await prisma.pipelineStage.createMany({
    data: [
      { organizationId: parent.id, label: "Nuevo", color: "#111", order: 1, isDefaultEntry: true },
      { organizationId: parent.id, label: "Cerrado", color: "#222", order: 2, role: "WON" },
    ],
  });
  await prisma.service.createMany({ data: [{ organizationId: parent.id, label: "Crédito", order: 0 }, { organizationId: parent.id, label: "Seguro", order: 1 }] });

    console.log("1) Crear suborganizaciones");
    const a = await createSubOrganization({ parentId: parent.id, name: "Sucursal Norte", sellerIds: [s1.id, s2.id], createdByUserId: admin.id });
    check("se crea con vendedores del padre", a.ok);
    if (!a.ok) throw new Error(a.error);
    const childA = await prisma.organization.findUniqueOrThrow({ where: { id: a.id }, include: { memberships: true, pipelineStages: true, services: true } });
    check("queda como hija del padre", childA.parentId === parent.id);
    check("copia el embudo y los servicios del padre", childA.pipelineStages.length === 2 && childA.services.map((s) => s.label).join() === "Crédito,Seguro");
    const role = (uid: string) => childA.memberships.find((m) => m.userId === uid)?.role;
    check("los administradores del padre entran como administradores", role(admin.id) === "OWNER" && role(admin2.id) === "OWNER");
    check("los vendedores elegidos entran como vendedores", role(s1.id) === "MEMBER" && role(s2.id) === "MEMBER");
    check("el vendedor no elegido NO entra", role(s3.id) === undefined);
    check("la hija no hereda el plan (no puede tener hijas)", childA.canHaveSubOrgs === false);

    console.log("2) Límites de usuarios compartidos");
    const counts = await getSeatCounts(parent.id);
    check("cuenta personas distintas en el grupo (2 admins, 3 vendedores)", counts.admins === 2 && counts.sellers === 3, JSON.stringify(counts));
    const fromChild = await getSeatPlan(childA.id);
    check("desde la hija se ven los topes y el uso del padre", fromChild.limits.maxSellers === 3 && fromChild.counts.sellers === 3 && fromChild.isGroup);
    check("una vendedora que ya está en el grupo no ocupa lugar nuevo", (await seatBlockedMessage(childA.id, "MEMBER", { userId: s3.id })) === null);
    check("una persona nueva sí: el plan está lleno", Boolean(await seatBlockedMessage(childA.id, "MEMBER", { userId: outsider.id })));
    check("subir a vendedora a administradora: no hay lugar de administrador", Boolean(await seatBlockedMessage(parent.id, "OWNER", { userId: s1.id })));

    console.log("3) Tope de suborganizaciones, un solo nivel y plan apagado");
    const b = await createSubOrganization({ parentId: parent.id, name: "Sucursal Sur", sellerIds: [], createdByUserId: admin.id });
    check("segunda suborganización (sin vendedores) se crea", b.ok);
    const c = await createSubOrganization({ parentId: parent.id, name: "Sucursal Este", sellerIds: [], createdByUserId: admin.id });
    check("la tercera se bloquea por el máximo del plan", !c.ok && /2 suborganizaciones/.test(c.ok ? "" : c.error), c.ok ? "" : c.error);
    const nested = await createSubOrganization({ parentId: a.id, name: "Nieta", sellerIds: [], createdByUserId: admin.id });
    check("una hija no puede tener hijas", !nested.ok, nested.ok ? "" : nested.error);
    const foreign = await createSubOrganization({ parentId: parent.id, name: "Con ajeno", sellerIds: [outsider.id], createdByUserId: admin.id });
    check("no se puede asignar a alguien que no es vendedor del padre", !foreign.ok);
    await prisma.organization.update({ where: { id: parent.id }, data: { canHaveSubOrgs: false } });
    const off = await createSubOrganization({ parentId: parent.id, name: "Sin plan", sellerIds: [], createdByUserId: admin.id });
    check("con la opción apagada en el plan no se crean", !off.ok, off.ok ? "" : off.error);
    await prisma.organization.update({ where: { id: parent.id }, data: { canHaveSubOrgs: true } });

    console.log("4) Cambiar los vendedores de una suborganización");
    const set = await setSubOrgSellers({ parentId: parent.id, childId: a.id, sellerIds: [s3.id], byUserId: admin.id });
    check("agrega y quita lo que corresponde", set.ok && set.added === 1 && set.removed === 2, JSON.stringify(set));
    const stillInParent = await prisma.organizationMembership.count({ where: { organizationId: parent.id, userId: { in: [s1.id, s2.id] } } });
    check("sacarlos de la hija no los saca del padre", stillInParent === 2);
    const adminsKept = await prisma.organizationMembership.count({ where: { organizationId: a.id, role: "OWNER" } });
    check("los administradores no se tocan", adminsKept === 2);
    const otherParent = await setSubOrgSellers({ parentId: outsider.id, childId: a.id, sellerIds: [], byUserId: admin.id });
    check("otra organización no puede tocar esta suborganización", !otherParent.ok);

    console.log("5) Aislamiento de datos");
    const bot = await prisma.bot.create({ data: { organizationId: a.id, name: "Bot hija" } });
    const contact = await prisma.contact.create({ data: { organizationId: a.id, phone: `5917${Date.now().toString().slice(-7)}`, fullName: "Cliente de la hija" } });
    await prisma.conversation.create({ data: { botId: bot.id, customerPhone: contact.phone, customerName: "Cliente de la hija", contactId: contact.id } });
    const parentSees = {
      contacts: await prisma.contact.count({ where: { organizationId: parent.id } }),
      conversations: await prisma.conversation.count({ where: { bot: { organizationId: parent.id } } }),
      bots: await prisma.bot.count({ where: { organizationId: parent.id } }),
    };
    check("el padre no ve contactos, chats ni bots de la hija", parentSees.contacts === 0 && parentSees.conversations === 0 && parentSees.bots === 0, JSON.stringify(parentSees));
    const childSees = await prisma.contact.count({ where: { organizationId: b.ok ? b.id : "" } });
    check("una hija no ve los datos de su hermana", childSees === 0);

    console.log("6) Accesos de administradores y salida del padre");
    await prisma.organizationMembership.deleteMany({ where: { userId: admin2.id, organizationId: a.id } });
    await ensureParentAdminsInChildren(parent.id);
    check("los administradores del padre se restituyen en las hijas", (await prisma.organizationMembership.count({ where: { userId: admin2.id, organizationId: a.id, role: "OWNER" } })) === 1);
    await syncChildrenForMember(parent.id, admin2.id, "MEMBER");
    check("si deja de ser administrador del padre, pierde el acceso de administrador a las hijas", (await prisma.organizationMembership.count({ where: { userId: admin2.id, organizationId: { in: [a.id, b.ok ? b.id : ""] } } })) === 0);
    await removeMembership(s3.id, parent.id);
    check("quien sale del padre sale también de sus hijas", (await prisma.organizationMembership.count({ where: { userId: s3.id } })) === 0);

    console.log("7) Marca heredada y borrado");
    const childBrand = resolveOrgBrand(childA, parent);
    check("la hija sin marca propia hereda la del padre", childBrand.name === "Matriz Financiera" && childBrand.color === "#1d4ed8");
    let blocked = false;
    try {
      await prisma.organization.delete({ where: { id: parent.id } });
    } catch {
      blocked = true;
    }
    check("no se puede borrar un padre que todavía tiene hijas", blocked);
    const listed = await listSubOrganizations(parent.id);
    check("el listado muestra las dos hijas", listed.length === 2);
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [parent.id] } } });
    await prisma.organization.deleteMany({ where: { parentId: parent.id } });
    await prisma.organization.deleteMany({ where: { id: parent.id } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${tag}@test.dev` } } });
  }
  console.log(failed ? `\n${failed} comprobaciones fallaron` : "\nTodo bien");
  if (failed) process.exitCode = 1;
}
main().catch((e) => { console.error("ERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
