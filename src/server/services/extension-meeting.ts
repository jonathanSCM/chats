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
  // Quién la está grabando (resuelto del token personal de la extensión) --
  // null si por alguna razón no se pudo identificar.
  recordedById?: string | null;
}): Promise<{ id: string; transcript: string | null; audioTranscript: string | null }> {
  const { organizationId, meetingUrl, recordedById = null } = params;

  const existing = await prisma.meeting.findFirst({
    where: { organizationId, meetingUrl, status: { not: "CANCELED" } },
    orderBy: { scheduledAt: "desc" },
    select: { id: true, transcript: true, audioTranscript: true, recordedById: true },
  });
  if (existing) {
    // No se pisa si ya había alguien -- se completa solo si todavía no se
    // sabía quién la estaba grabando.
    if (!existing.recordedById && recordedById) {
      await prisma.meeting.update({ where: { id: existing.id }, data: { recordedById } });
    }
    return existing;
  }

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
      recordedById,
    },
    select: { id: true, transcript: true, audioTranscript: true },
  });
}
