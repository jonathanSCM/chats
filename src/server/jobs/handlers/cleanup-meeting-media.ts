import { prisma } from "@/server/db/client";
import { deleteMediaFile } from "@/lib/media-storage";
import { enqueueOrReschedule } from "../queue";

const RETENTION_DAYS = 7;
const RESCHEDULE_HOURS = 24;
export const CLEANUP_MEETING_MEDIA_UNIQUE_KEY = "cleanup_meeting_media_daily";

// Los adjuntos de reunión (grabación, PDF de resumen, capturas) son lo que
// más espacio pesa — la transcripción y el resumen de IA quedan como texto
// directo en `Meeting` y no se tocan acá. Pasada una semana desde que se
// generó el adjunto, se borra el archivo real (S3 o disco) y la fila: no
// tiene sentido conservar el registro sin el archivo que describe.
export async function handleCleanupMeetingMedia(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const stale = await prisma.meetingAttachment.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, url: true },
  });

  for (const attachment of stale) {
    try {
      await deleteMediaFile(attachment.url);
    } catch (error) {
      // Si el archivo ya no existe en el storage, igual conviene limpiar la
      // fila — quedaría huérfana para siempre si se corta acá.
      console.error(`[cleanup-meeting-media] No se pudo borrar el archivo de ${attachment.id}:`, error);
    }
    await prisma.meetingAttachment.delete({ where: { id: attachment.id } }).catch(() => {});
  }

  if (stale.length > 0) {
    console.log(`[cleanup-meeting-media] Borrados ${stale.length} adjunto(s) de más de ${RETENTION_DAYS} días.`);
  }

  // Se reprograma a sí mismo para el día siguiente — así corre una vez al
  // día sin necesitar un cron aparte del que ya procesa la cola cada minuto.
  await enqueueOrReschedule({
    type: "cleanup_meeting_media",
    payload: {},
    uniqueKey: CLEANUP_MEETING_MEDIA_UNIQUE_KEY,
    runAfter: new Date(Date.now() + RESCHEDULE_HOURS * 60 * 60 * 1000),
  });
}
