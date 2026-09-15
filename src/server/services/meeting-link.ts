import { prisma } from "@/server/db/client";
import { isOpenStage, type Stage } from "@/lib/pipeline";

// Nombres que el bot/la extensión ponen cuando no identificó a quién habló
// -- no sirven como pista de a qué cliente corresponde la reunión.
const GENERIC_SPEAKER_NAMES = new Set(["alguien", "?", "unknown", "tú", "yo"]);

/** Saca los nombres únicos de "Nombre: lo que dijo" (formato del transcript de subtítulos). */
function extractSpeakerNames(transcript: string): string[] {
  const names = new Set<string>();
  for (const line of transcript.split("\n")) {
    const match = line.match(/^([^:]{2,60}):\s/);
    const name = match?.[1]?.trim();
    if (name && !GENERIC_SPEAKER_NAMES.has(name.toLowerCase())) {
      names.add(name);
    }
  }
  return [...names];
}

/**
 * Intenta vincular automáticamente una reunión suelta (sin opportunityId) al
 * cliente correspondiente, a partir de quién habló en la transcripción de
 * subtítulos. A propósito conservador: solo vincula si hay una única
 * coincidencia sin ambigüedad -- si un nombre no matchea ningún contacto, si
 * matchea varios, o si el contacto tiene más de una oportunidad abierta, no
 * adivina y deja la reunión para vincular a mano (ver
 * linkMeetingToOpportunityAction). No hace nada si la reunión ya tiene
 * cliente.
 */
export async function attemptAutoLinkMeeting(meetingId: string): Promise<void> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { organizationId: true, opportunityId: true, transcript: true },
  });
  if (!meeting || meeting.opportunityId || !meeting.transcript) return;

  const names = extractSpeakerNames(meeting.transcript);
  if (names.length === 0) return;

  const matchedContactIds = new Set<string>();
  for (const name of names) {
    const contacts = await prisma.contact.findMany({
      where: { organizationId: meeting.organizationId, fullName: { contains: name, mode: "insensitive" } },
      select: { id: true },
      take: 5,
    });
    for (const c of contacts) matchedContactIds.add(c.id);
    // Más de un contacto ya matcheado (sea de este nombre o de uno anterior)
    // es ambigüedad -- cortamos temprano, no hay forma de estar seguros.
    if (matchedContactIds.size > 1) return;
  }
  if (matchedContactIds.size !== 1) return;

  const [contactId] = matchedContactIds;
  const opportunities = await prisma.opportunity.findMany({
    where: { contactId, archivedAt: null },
    select: { id: true, stage: true },
  });
  const openOnes = opportunities.filter((o) => isOpenStage(o.stage as Stage));
  if (openOnes.length !== 1) return;

  await prisma.meeting.update({ where: { id: meetingId }, data: { opportunityId: openOnes[0].id } });
}
