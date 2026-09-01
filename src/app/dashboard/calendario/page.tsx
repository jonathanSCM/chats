import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { CalendarList } from "./_components/calendar-list";

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ pasadas?: string }>;
}) {
  const session = await auth();
  if (!session?.user.organizationId) redirect("/dashboard");

  const { pasadas } = await searchParams;
  const viewingPast = pasadas === "1";
  const organizationId = session.user.organizationId;

  const now = new Date();
  const meetings = await prisma.meeting.findMany({
    where: {
      organizationId,
      opportunity: { archivedAt: null },
      scheduledAt: viewingPast ? { lt: now } : { gte: now },
    },
    include: {
      opportunity: {
        select: {
          id: true,
          title: true,
          serviceInterest: true,
          stage: true,
          contact: { select: { fullName: true, phone: true } },
          assignedTo: { select: { id: true, name: true, email: true, color: true } },
        },
      },
    },
    orderBy: { scheduledAt: viewingPast ? "desc" : "asc" },
  });

  const rows = meetings.map((m) => ({
    id: m.id,
    scheduledAt: m.scheduledAt.toISOString(),
    durationMinutes: m.durationMinutes,
    meetingUrl: m.meetingUrl,
    status: m.status,
    opportunityId: m.opportunity?.id ?? null,
    client: m.opportunity?.contact.fullName || m.opportunity?.contact.phone || "—",
    service: m.opportunity?.serviceInterest ?? "",
    need: m.opportunity?.title ?? "",
    assignedTo: m.opportunity?.assignedTo
      ? {
          id: m.opportunity.assignedTo.id,
          name: m.opportunity.assignedTo.name || m.opportunity.assignedTo.email,
          color: m.opportunity.assignedTo.color,
        }
      : null,
  }));

  return (
    <div className="animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Calendario</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Las reuniones agendadas en Seguimiento, todas juntas en un solo lugar.
      </p>

      <CalendarList rows={rows} viewingPast={viewingPast} />
    </div>
  );
}
