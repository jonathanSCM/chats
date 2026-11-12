import { prisma } from "@/server/db/client";
async function main() {
  const org = await prisma.organization.findFirstOrThrow();
  const base = { organizationId: org.id, durationMinutes: 45, status: "DONE" as const, botEnabled: false };
  await prisma.meeting.create({ data: { ...base, title: "PRUEBA · Reunión del equipo (semanal)", scheduledAt: new Date(Date.now() - 86_400_000), isTeam: true } });
  await prisma.meeting.create({ data: { ...base, title: "PRUEBA · Reunión sin marcar", scheduledAt: new Date(Date.now() - 2 * 86_400_000) } });
  console.log("creadas");
  await prisma.$disconnect();
}
main();
