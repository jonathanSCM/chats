import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { hasGoogleCalendarConnected } from "@/server/services/google-calendar-user";
import { AdhocMeetingsClient } from "./_components/adhoc-meetings-client";
import { ReunionesTabs } from "./_components/reuniones-tabs";

export default async function ReunionesPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const session = await auth();
  if (!session?.user.organizationId) redirect("/dashboard");

  const { open } = await searchParams;
  const canCreateGoogleMeet = await hasGoogleCalendarConnected(session.user.id);

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
      botJoinedAt: true,
      botLeftAt: true,
      botEnabled: true,
      notes: true,
      transcript: true,
      audioTranscript: true,
      aiSummary: true,
      aiSummaryData: true,
      aiSummaryAt: true,
      attachments: {
        select: { id: true, url: true, fileName: true, mimeType: true, fileSize: true },
        orderBy: { createdAt: "asc" },
      },
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
    botJoinedAt: m.botJoinedAt?.toISOString() ?? null,
    botLeftAt: m.botLeftAt?.toISOString() ?? null,
    botEnabled: m.botEnabled,
    notes: m.notes ?? "",
    transcript: m.transcript ?? "",
    audioTranscript: m.audioTranscript ?? "",
    aiSummary: m.aiSummary ?? "",
    aiSummaryData: m.aiSummaryData ?? null,
    aiSummaryAt: m.aiSummaryAt?.toISOString() ?? null,
    attachments: m.attachments,
  }));

  return (
    <div className="animate-fade-up">
      <h1 className="mb-1 text-2xl font-bold">Reuniones</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Reuniones internas que no pasan por Seguimiento — con empleados, dirección, o cualquier
        reunión de emergencia que necesite grabarse.
      </p>

      <ReunionesTabs active="internas" />

      <AdhocMeetingsClient meetings={rows} openId={open ?? null} canCreateGoogleMeet={canCreateGoogleMeet} />
    </div>
  );
}
