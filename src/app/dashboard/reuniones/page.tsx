import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { AdhocMeetingsClient } from "./_components/adhoc-meetings-client";

export default async function ReunionesPage() {
  const session = await auth();
  if (!session?.user.organizationId) redirect("/dashboard");

  const meetings = await prisma.meeting.findMany({
    where: { organizationId: session.user.organizationId, opportunityId: null },
    orderBy: { scheduledAt: "desc" },
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      durationMinutes: true,
      meetingUrl: true,
      status: true,
      botStatus: true,
      notes: true,
      aiSummary: true,
    },
  });

  const rows = meetings.map((m) => ({
    id: m.id,
    title: m.title || "Reunión interna",
    scheduledAt: m.scheduledAt.toISOString(),
    durationMinutes: m.durationMinutes,
    meetingUrl: m.meetingUrl,
    status: m.status,
    botStatus: m.botStatus,
    notes: m.notes ?? "",
    aiSummary: m.aiSummary ?? "",
  }));

  return (
    <div className="animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Reuniones</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Reuniones internas que no pasan por Seguimiento — con empleados, dirección, o cualquier
        reunión de emergencia que necesite grabarse.
      </p>

      <AdhocMeetingsClient meetings={rows} />
    </div>
  );
}
