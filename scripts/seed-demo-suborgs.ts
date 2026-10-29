// Datos de DEMOSTRACIÓN para probar organizaciones, planes y suborganizaciones en LOCAL.
// Solo para la base local de desarrollo; las credenciales de abajo son de prueba y no existen en producción.
//   Uso:  npx tsx --env-file=.env scripts/seed-demo-suborgs.ts
// Es repetible: borra lo que creó la vez anterior y lo vuelve a crear.
import bcrypt from "bcryptjs";
import { prisma } from "@/server/db/client";
import { DEFAULT_PIPELINE_STAGES, DEFAULT_SERVICES } from "@/lib/pipeline";

const PASSWORD = "DemoLocal#2026";
const DOMAIN = "demo.local";

const USERS = {
  superadmin: { email: `superadmin@${DOMAIN}`, name: "Superadmin Demo" },
  admin: { email: `admin@${DOMAIN}`, name: "Ana (administradora)" },
  admin2: { email: `admin2@${DOMAIN}`, name: "Beto (segundo administrador)" },
  seller1: { email: `vendedor1@${DOMAIN}`, name: "Carla (vendedora)" },
  seller2: { email: `vendedor2@${DOMAIN}`, name: "Diego (vendedor)" },
  seller3: { email: `vendedor3@${DOMAIN}`, name: "Elena (vendedora)" },
  solo: { email: `cliente-simple@${DOMAIN}`, name: "Dueño de un plan simple" },
} as const;

async function seedOrgDefaults(organizationId: string) {
  await prisma.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((s) => ({
      organizationId,
      label: s.label,
      color: s.color,
      criteria: s.criteria,
      order: s.order,
      role: s.role,
      isDefaultEntry: s.isDefaultEntry,
      requiresProposalFields: s.requiresProposalFields,
    })),
  });
  await prisma.service.createMany({ data: DEFAULT_SERVICES.map((label, order) => ({ organizationId, label, order })) });
}

async function main() {
  // Limpieza de una corrida anterior (primero las hijas: el padre no se puede borrar con hijas).
  const old = await prisma.organization.findMany({ where: { slug: { in: ["demo-financiera", "demo-cliente-simple"] } }, select: { id: true } });
  const oldIds = old.map((o) => o.id);
  await prisma.organization.deleteMany({ where: { parentId: { in: oldIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: oldIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (u: { email: string; name: string }, role: "SUPERADMIN" | "OWNER" | "MEMBER", organizationId: string | null) =>
    prisma.user.create({ data: { ...u, passwordHash, role, organizationId, emailVerified: new Date() } });

  // Organización principal, con un plan que habilita todo.
  const parent = await prisma.organization.create({
    data: {
      name: "Demo Financiera",
      slug: "demo-financiera",
      canHaveSubOrgs: true,
      maxSubOrgs: 3,
      maxAdmins: 2,
      maxSellers: 4,
      canCustomizeBrand: true,
      aiOwnKeyEnabled: true,
    },
  });
  await seedOrgDefaults(parent.id);

  const admin = await mk(USERS.admin, "OWNER", parent.id);
  const admin2 = await mk(USERS.admin2, "OWNER", parent.id);
  const sellers = [await mk(USERS.seller1, "MEMBER", parent.id), await mk(USERS.seller2, "MEMBER", parent.id), await mk(USERS.seller3, "MEMBER", parent.id)];
  await prisma.organizationMembership.createMany({
    data: [
      { userId: admin.id, organizationId: parent.id, role: "OWNER" },
      { userId: admin2.id, organizationId: parent.id, role: "OWNER" },
      ...sellers.map((s) => ({ userId: s.id, organizationId: parent.id, role: "MEMBER" as const })),
    ],
  });

  // Una organización "normal" con topes bajos, para ver los límites de usuarios sin suborganizaciones.
  const solo = await prisma.organization.create({
    data: { name: "Demo Cliente Simple", slug: "demo-cliente-simple", maxAdmins: 1, maxSellers: 1 },
  });
  await seedOrgDefaults(solo.id);
  const soloOwner = await mk(USERS.solo, "OWNER", solo.id);
  await prisma.organizationMembership.create({ data: { userId: soloOwner.id, organizationId: solo.id, role: "OWNER" } });

  await mk(USERS.superadmin, "SUPERADMIN", null);

  console.log("Datos de demostración listos.");
  console.log(`  Contraseña de todas las cuentas: ${PASSWORD}`);
  for (const [k, u] of Object.entries(USERS)) console.log(`  ${k.padEnd(10)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
