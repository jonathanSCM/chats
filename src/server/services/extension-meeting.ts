import { prisma } from "@/server/db/client";

/**
 * Encuentra o crea la reunión que le corresponde a un link de Meet que
 * mandó la extensión de subtítulos (texto o audio) -- compartido entre
 * api/extension/transcript y api/extension/audio para no duplicar el mismo
 * criterio dos veces. Si el link ya estaba agendado en el sistema, se usa
 * esa reunión (la más reciente con ese link, por si una sala se reutiliza
 * con el tiempo); si no, se crea una nueva "Reunión Extensión" -- mismo
 * patrón que "Unir el bot ya mismo" con reuniones en vivo sin agendar.
 */
export async function resolveExtensionMeeting(params: {
  organizationId: string;
  meetingUrl: string;
}): Promise<{ id: string; transcript: string | null; audioTranscript: string | null }> {
  const { organizationId, meetingUrl } = params;

  const existing = await prisma.meeting.findFirst({
    where: { organizationId, meetingUrl, status: { not: "CANCELED" } },
    orderBy: { scheduledAt: "desc" },
    select: { id: true, transcript: true, audioTranscript: true },
  });
  if (existing) return existing;

  return prisma.meeting.create({
    data: {
      organizationId,
      opportunityId: null,
      title: "Reunión Extensión",
      scheduledAt: new Date(),
      durationMinutes: 30,
      meetingUrl,
      status: "DONE",
      botEnabled: false,
    },
    select: { id: true, transcript: true, audioTranscript: true },
  });
}
