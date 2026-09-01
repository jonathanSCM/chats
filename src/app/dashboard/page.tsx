import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { DashboardPreview } from "./_components/dashboard-preview";

export default async function DashboardPage() {
  const session = await auth();
  if (session?.user.role === "SUPERADMIN" && !session.user.organizationId) redirect("/admin");
  if (!session?.user.organizationId) redirect("/login");

  const organizationId = session.user.organizationId;

  // Lo único real de esta pantalla por ahora: las próximas reuniones. El
  // resto (KPIs, donut, barras) es vista previa con datos de ejemplo —
  // se conecta a datos reales en una pasada aparte, a propósito.
  const meetings = await prisma.meeting.findMany({
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
  });

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
    <DashboardPreview
      userName={session.user.name || session.user.email || "de nuevo"}
      upcomingMeetings={upcomingMeetings}
    />
  );
}
