import { prisma } from "@/server/db/client";
import { saveMediaFile } from "@/lib/media-storage";
import { isAiEnabledFor, AiBudgetExceededError } from "@/server/services/ai/client";
import { renderMeetingSummaryPdf, type MeetingSummary } from "@/server/services/meeting-summary-pdf";
import { ensureMeetingSummaryData } from "@/server/services/meeting-summary";

/**
 * "Generar resumen (PDF)" — arma un resumen ejecutivo con IA a partir de la
 * transcripción disponible (subtítulos con nombres si los hay; si no, la de
 * whisper.cpp sobre el audio completo) y lo guarda como un adjunto PDF más,
 * para abrir dentro de la web.
 */
export async function requestMeetingSummaryPdf(
  meetingId: string,
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isAiEnabledFor(organizationId))) {
    return { ok: false, error: "La IA no está configurada en el servidor." };
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { organizationId: true, transcript: true, audioTranscript: true, title: true, scheduledAt: true },
  });
  if (!meeting || meeting.organizationId !== organizationId) return { ok: false, error: "Reunión no encontrada" };
  const transcriptText = meeting.transcript || meeting.audioTranscript;
  if (!transcriptText) {
    return { ok: false, error: "Todavía no hay transcripción para resumir." };
  }

  try {
    const data = await ensureMeetingSummaryData(meetingId);
    if (!data) return { ok: false, error: "No se pudo generar el resumen." };
    const summary: MeetingSummary = {
      resumen: data.resumen,
      puntosClave: data.puntosClave,
      decisiones: data.decisiones,
      proximosPasos: data.proximosPasos.map(
        (p) => `${p.accion}${p.responsable ? ` — ${p.responsable}` : ""}${p.fecha ? ` (${p.fecha})` : ""}`,
      ),
    };
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
