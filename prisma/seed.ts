import bcrypt from "bcryptjs";
import { prisma } from "@/server/db/client";

async function main() {
  const plans = await Promise.all(
    [
      { name: "Starter", aiModel: "gpt-4o-mini", conversationLimit: 200, priceCents: 2900 },
      { name: "Pro", aiModel: "gpt-4o-mini", conversationLimit: 1000, priceCents: 7900 },
      { name: "Elite", aiModel: "gpt-4o", conversationLimit: 5000, priceCents: 19900 },
    ].map((plan) =>
      prisma.plan.upsert({ where: { name: plan.name }, create: plan, update: plan }),
    ),
  );
  const proPlan = plans.find((p) => p.name === "Pro")!;

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

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + 30);

  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      planId: proPlan.id,
      status: "ACTIVE",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
    update: {},
  });

  const bot = await prisma.bot.upsert({
    where: { id: "demo-bot-seed-id" },
    create: {
      id: "demo-bot-seed-id",
      organizationId: org.id,
      name: "Vendedor Demo",
      status: "DRAFT",
    },
    update: {},
  });

  await prisma.botConfig.upsert({
    where: { botId: bot.id },
    create: {
      botId: bot.id,
      companyName: "Demo Company",
      personality: "Cercano, entusiasta y directo. Usa emojis con moderación.",
      instructions:
        "Ayuda al cliente a elegir un producto del catálogo y guíalo hacia el pago. Si pregunta algo fuera del catálogo, sé honesto y ofrece escalar con un humano.",
      welcomeMessage: "¡Hola! 👋 Soy el asistente de Demo Company, ¿en qué te puedo ayudar hoy?",
    },
    update: {},
  });

  await prisma.catalogItem.createMany({
    data: [
      { botId: bot.id, name: "Plan Básico", price: 19.99, description: "Ideal para empezar" },
      { botId: bot.id, name: "Plan Pro", price: 49.99, description: "Para equipos en crecimiento" },
    ],
    skipDuplicates: true,
  });

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
