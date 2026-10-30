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
  // "Reuniones del equipo" solo tiene sentido si la organización tiene habilitado el Jefe de Operaciones.
  const org = await prisma.organization.findUnique({
    where: { id: session.user.organizationId },
    select: { jefeEnabled: true },
  });
  const jefeEnabled = org?.jefeEnabled ?? false;
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
      isTeam: true,
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
    isTeam: m.isTeam,
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
      <p className="mb-4 text-sm text-ink-muted">
        Reuniones internas que no pasan por Seguimiento — con empleados, dirección, o cualquier
        reunión de emergencia que necesite grabarse.
        {jefeEnabled && (
          <>
            {" "}
            Marca las que sean <b>del equipo</b>: el Jefe de Operaciones solo lee esas para sacar tareas.
          </>
        )}
      </p>

      <ReunionesTabs active="internas" />

      <AdhocMeetingsClient
        meetings={rows}
        openId={open ?? null}
        canCreateGoogleMeet={canCreateGoogleMeet}
        jefeEnabled={jefeEnabled}
      />
    </div>
  );
}
