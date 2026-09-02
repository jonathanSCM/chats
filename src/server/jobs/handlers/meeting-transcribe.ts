import { z } from "zod";
import { prisma } from "@/server/db/client";
import { readMediaFile } from "@/lib/media-storage";
import { transcribeAudio, runStructured, isAiEnabled, MODELS } from "@/server/services/ai/client";

export const meetingTranscribePayload = z.object({
  meetingId: z.string(),
  attachmentId: z.string(),
});

const SUMMARY_SYSTEM =
  "Resumí la transcripción de una reunión en 3 a 5 oraciones, en español, mencionando decisiones " +
  "tomadas y próximos pasos si los hay. No inventes nada que no esté en el texto.";

const SUMMARY_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
} as const;

function parseSummary(raw: unknown): string {
  const summary = (raw as { summary?: unknown }).summary;
  if (typeof summary !== "string") throw new Error("Respuesta de resumen inválida");
  return summary;
}

/**
 * Transcribe el audio que subió el bot (Whisper) y guarda el texto en
 * `Meeting.notes` — mismo campo que ya se usa para transcripciones pegadas a
 * mano. El resumen (`aiSummary`) es best-effort: si falla no se reintenta la
 * transcripción entera solo por eso, ya quedó guardada.
 */
export async function handleMeetingTranscribe(rawPayload: unknown): Promise<void> {
  const { meetingId, attachmentId } = meetingTranscribePayload.parse(rawPayload);

  const [meeting, attachment] = await Promise.all([
    prisma.meeting.findUnique({ where: { id: meetingId }, select: { id: true, organizationId: true } }),
    prisma.meetingAttachment.findUnique({ where: { id: attachmentId } }),
  ]);
  if (!meeting || !attachment) return;

  const buffer = await readMediaFile(attachment.url);
  const transcript = await transcribeAudio(buffer, attachment.fileName, attachment.mimeType);

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { notes: transcript, botStatus: "DONE" },
  });

  if (!isAiEnabled()) return;

  try {
    const summary = await runStructured({
      organizationId: meeting.organizationId,
      entityType: "Meeting",
      entityId: meetingId,
      analysisType: "meeting_summary",
      promptVersion: "v1",
      model: MODELS.fast(),
      system: SUMMARY_SYSTEM,
      input: transcript,
      schemaName: "meeting_summary",
      schema: SUMMARY_SCHEMA,
      parse: parseSummary,
    });
    await prisma.meeting.update({ where: { id: meetingId }, data: { aiSummary: summary } });
  } catch (error) {
    console.error(`[meeting-transcribe] No se pudo generar el resumen de ${meetingId}:`, error);
  }
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
