import { z } from "zod";
import { prisma } from "@/server/db/client";
import { readMediaFile } from "@/lib/media-storage";
import { transcribeAudio } from "@/server/services/ai/client";

export const meetingTranscribePayload = z.object({
  meetingId: z.string(),
  attachmentId: z.string(),
});

/**
 * Transcribe el audio que subió el bot (Whisper, sin nombres de quién habló
 * — esto es el fallback para cuando no se pudieron leer los subtítulos en
 * vivo de Meet) y guarda el texto en `Meeting.transcript`. Se dispara solo
 * cuando alguien lo pide a mano (botón "Transcribir"), no automático — ver
 * `transcribeMeetingAction`. El resumen en PDF es una acción aparte
 * (`generateMeetingSummaryPdfAction`), no se genera acá.
 */
export async function handleMeetingTranscribe(rawPayload: unknown): Promise<void> {
  const { meetingId, attachmentId } = meetingTranscribePayload.parse(rawPayload);

  const attachment = await prisma.meetingAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) return;

  const buffer = await readMediaFile(attachment.url);
  const transcript = await transcribeAudio(buffer, attachment.fileName, attachment.mimeType);

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { transcript, botStatus: "DONE" },
  });
}

/** Se agotaron los reintentos de transcribir — queda visible como fallido, el audio no se pierde. */
export async function markMeetingTranscribeFailed(rawPayload: unknown): Promise<void> {
  const parsed = meetingTranscribePayload.safeParse(rawPayload);
  if (!parsed.success) return;

  await prisma.meeting.updateMany({
    where: { id: parsed.data.meetingId },
    data: { botStatus: "FAILED" },
  });
}
