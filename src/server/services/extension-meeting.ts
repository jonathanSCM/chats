import { prisma } from "@/server/db/client";
import { extractMeetCode, normalizeMeetUrl } from "@/lib/meet-code";

/** La cuenta interna con la que el parche del asistente (Vexa) habla con el CRM: sirve a todas las organizaciones. */
const PLATFORM_BOT_EMAIL_SUFFIX = "@internal.proshop.lat";

export function isPlatformBotEmail(email: string): boolean {
  return email.endsWith(PLATFORM_BOT_EMAIL_SUFFIX);
}

/**
 * Organización a la que pertenece lo que manda este token para esta reunión. Una persona (extensión de Chrome) trabaja
 * en SU organización. El asistente es uno solo para todas: su token es de una cuenta interna de ProShop, así que la
 * organización sale de la reunión a la que pertenece ese asistente: primero por el id de su sesión de Vexa (cada
 * reunión del CRM lo guarda al pedir el asistente: es exacto, aunque el mismo link de Meet lo usen dos organizaciones) y,
 * si el asistente no lo mandó, por el link. Sin esto, subtítulos, comandos y cobros de otras organizaciones iban a ProShop.
 */
export async function resolveExtensionOrganizationId(
  user: { organizationId: string; email: string },
  meetingUrl: string,
  vexaSessionId?: number | null,
): Promise<string> {
  if (!isPlatformBotEmail(user.email)) return user.organizationId;
  if (vexaSessionId) {
    const bySession = await prisma.meeting.findFirst({
      where: { vexaSessionId },
      orderBy: { createdAt: "desc" },
      select: { organizationId: true },
    });
    if (bySession) return bySession.organizationId;
  }
  const code = extractMeetCode(meetingUrl);
  if (!code) return user.organizationId;
  const meeting = await prisma.meeting.findFirst({
    where: { meetingUrl: { contains: code, mode: "insensitive" }, botStatus: { not: null }, status: { not: "CANCELED" } },
    orderBy: { createdAt: "desc" },
    select: { organizationId: true },
  });
  return meeting?.organizationId ?? user.organizationId;
}

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
  // Id de la sesión del asistente en Vexa: identifica la reunión exacta (ver resolveExtensionOrganizationId).
  vexaSessionId?: number | null;
}): Promise<{ id: string; transcript: string | null; audioTranscript: string | null }> {
  const { organizationId, recordedById = null, vexaSessionId = null } = params;

  if (vexaSessionId) {
    const bySession = await prisma.meeting.findFirst({
      where: { organizationId, vexaSessionId, status: { not: "CANCELED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, transcript: true, audioTranscript: true },
    });
    if (bySession) return bySession;
  }

  // El mismo link llega escrito de varias formas (meet.google.com/abc-defg-hij, /meet/abc-defg-hij, con parámetros):
  // se busca por el código de la sala y las reuniones nuevas se guardan con el link canónico.
  const code = extractMeetCode(params.meetingUrl);
  const meetingUrl = normalizeMeetUrl(params.meetingUrl) ?? params.meetingUrl;

  const existing = await prisma.meeting.findFirst({
    where: {
      organizationId,
      meetingUrl: code ? { contains: code, mode: "insensitive" } : meetingUrl,
      status: { not: "CANCELED" },
    },
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
