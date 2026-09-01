import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { DashboardClient } from "./_components/dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (session?.user.role === "SUPERADMIN" && !session.user.organizationId) redirect("/admin");
  if (!session?.user.organizationId) redirect("/login");

  const organizationId = session.user.organizationId;

  const [meetings, members, sourcesRaw] = await Promise.all([
    prisma.meeting.findMany({
      where: { organizationId, opportunity: { archivedAt: null }, scheduledAt: { gte: new Date() } },
      include: {
        opportunity: {
          select: {
            id: true,
            contact: { select: { fullName: true, phone: true } },
            assignedTo: { select: { id: true, name: true, email: true, color: true } },
          },
        },
      },
      orderBy: { scheduledAt: "asc" },
      take: 4,
    }),
    prisma.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.contact.findMany({
      where: { organizationId, source: { not: null } },
      select: { source: true },
      distinct: ["source"],
    }),
  ]);

  const upcomingMeetings = meetings.map((m) => ({
    id: m.id,
    scheduledAt: m.scheduledAt.toISOString(),
    opportunityId: m.opportunity?.id ?? null,
    client: m.opportunity?.contact.fullName || m.opportunity?.contact.phone || "—",
    assignedTo: m.opportunity?.assignedTo
      ? {
          id: m.opportunity.assignedTo.id,
          name: m.opportunity.assignedTo.name || m.opportunity.assignedTo.email,
          color: m.opportunity.assignedTo.color,
        }
      : null,
  }));

  return (
    <DashboardClient
      userName={session.user.name || session.user.email || "de nuevo"}
      upcomingMeetings={upcomingMeetings}
      members={members.map((m) => ({ id: m.id, name: m.name || m.email }))}
      sources={sourcesRaw.map((s) => s.source!).filter(Boolean)}
    />
  );
}
