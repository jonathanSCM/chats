import bcrypt from "bcryptjs";
import { prisma } from "@/server/db/client";

async function main() {
  const superadminPassword = await bcrypt.hash("changeme123", 12);
  await prisma.user.upsert({
    where: { email: "admin@zocalo.dev" },
    create: {
      email: "admin@zocalo.dev",
      passwordHash: superadminPassword,
      name: "Superadmin",
      role: "SUPERADMIN",
    },
    update: {},
  });

  const org = await prisma.organization.upsert({
    where: { slug: "demo" },
    create: { name: "Demo Company", slug: "demo" },
    update: {},
  });

  const ownerPassword = await bcrypt.hash("changeme123", 12);
  await prisma.user.upsert({
    where: { email: "owner@demo.dev" },
    create: {
      email: "owner@demo.dev",
      passwordHash: ownerPassword,
      name: "Dueño Demo",
      role: "OWNER",
      organizationId: org.id,
    },
    update: { organizationId: org.id },
  });

  await prisma.bot.upsert({
    where: { id: "demo-bot-seed-id" },
    create: {
      id: "demo-bot-seed-id",
      organizationId: org.id,
      name: "Número principal",
      status: "DRAFT",
    },
    update: {},
  });

  // Base de conocimiento de ejemplo — es lo que la IA cita al analizar
  // conversaciones y recomendar. En producción se edita desde el panel.
  const knowledgeSeed = [
    {
      category: "TONE" as const,
      title: "Tono de comunicación",
      content:
        "Cercano y profesional. Mensajes breves, apropiados para WhatsApp. Nunca presionar al cliente ni prometer resultados garantizados.",
    },
    {
      category: "QUALIFICATION" as const,
      title: "Cómo calificar un lead",
      content:
        "Antes de cotizar hay que entender: cuál es el problema concreto, qué proceso usan hoy, qué volumen manejan, quién toma la decisión y para cuándo lo necesitan.",
    },
  ];

  for (const item of knowledgeSeed) {
    const exists = await prisma.knowledgeItem.findFirst({
      where: { organizationId: org.id, title: item.title },
    });
    if (!exists) {
      await prisma.knowledgeItem.create({ data: { ...item, organizationId: org.id } });
    }
  }

  console.log("Seed completo:");
  console.log("  superadmin: admin@zocalo.dev / changeme123");
  console.log("  owner demo: owner@demo.dev / changeme123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
