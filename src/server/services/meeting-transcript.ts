import { prisma } from "@/server/db/client";
import { enqueueOrReschedule, runJobsSoon } from "@/server/jobs";
import { saveMediaFile } from "@/lib/media-storage";
import { isAiEnabled, AiBudgetExceededError } from "@/server/services/ai/client";
import { summarizeMeetingTranscript, renderMeetingSummaryPdf } from "@/server/services/meeting-summary-pdf";

/**
 * "Transcribir" a pedido (botón en la UI) — fallback con Whisper, sin
 * nombres de quién habló, para cuando no vino transcripción de subtítulos
 * en vivo desde el bot. Solo tiene sentido si el audio ya está subido
 * (`botStatus === "RECORDED"`).
 */
export async function requestMeetingTranscription(meetingId: string): Promise<{ ok: boolean; error?: string }> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { botStatus: true, attachments: { orderBy: { createdAt: "desc" } } },
  });
  if (!meeting) return { ok: false, error: "Reunión no encontrada" };
  if (meeting.botStatus !== "RECORDED") {
    return { ok: false, error: "Esta reunión no tiene audio pendiente de transcribir." };
  }

  const audioAttachment = meeting.attachments.find((a) => a.mimeType.startsWith("audio/"));
  if (!audioAttachment) {
    return { ok: false, error: "No se encontró el audio de la reunión." };
  }

  await prisma.meeting.update({ where: { id: meetingId }, data: { botStatus: "TRANSCRIBING" } });
  await enqueueOrReschedule({
    type: "meeting_transcribe",
    uniqueKey: `meeting-transcribe-${audioAttachment.id}`,
    payload: { meetingId, attachmentId: audioAttachment.id },
  });
  runJobsSoon();

  return { ok: true };
}

/**
 * "Generar resumen (PDF)" — arma un resumen ejecutivo con IA a partir de
 * `Meeting.transcript` (de cualquiera de las dos fuentes: subtítulos o
 * Whisper) y lo guarda como un adjunto PDF más, para abrir dentro de la web.
 */
export async function requestMeetingSummaryPdf(
  meetingId: string,
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isAiEnabled()) {
    return { ok: false, error: "La IA no está configurada en el servidor." };
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { transcript: true, title: true, scheduledAt: true },
  });
  if (!meeting) return { ok: false, error: "Reunión no encontrada" };
  if (!meeting.transcript) {
    return { ok: false, error: "Todavía no hay transcripción para resumir." };
  }

  try {
    const summary = await summarizeMeetingTranscript({ organizationId, meetingId, transcript: meeting.transcript });
    const pdfBuffer = await renderMeetingSummaryPdf({
      title: meeting.title || "Resumen de reunión",
      scheduledAt: meeting.scheduledAt,
      summary,
    });
    const url = await saveMediaFile(pdfBuffer, "application/pdf");
    await prisma.meetingAttachment.create({
      data: {
        meetingId,
        url,
        fileName: `resumen-${meetingId}.pdf`,
        mimeType: "application/pdf",
        fileSize: pdfBuffer.length,
      },
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof AiBudgetExceededError) {
      return { ok: false, error: "Se alcanzó el tope de gasto diario de IA. Probá de nuevo mañana." };
    }
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo generar el resumen." };
  }
}
