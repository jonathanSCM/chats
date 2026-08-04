import { z } from "zod";
import { prisma } from "@/server/db/client";
import { decrypt } from "@/lib/crypto";
import { getMediaUrl, downloadMedia } from "@/server/services/whatsapp";
import { saveMediaFile } from "@/lib/media-storage";

export const downloadMediaPayload = z.object({
  messageId: z.string(),
  mediaId: z.string(),
  phoneNumberId: z.string(),
});

/**
 * Descarga un archivo del CDN de Meta y lo guarda en el storage propio.
 *
 * Corre como job y no dentro del webhook: la descarga tarda segundos y Meta
 * reintenta el webhook si no respondemos rápido, lo que duplicaba trabajo.
 * Si falla, la cola reintenta con espera progresiva; al agotar los intentos
 * el mensaje queda marcado FAILED y el vendedor ve el aviso en el chat.
 */
export async function handleDownloadMedia(rawPayload: unknown): Promise<void> {
  const { messageId, mediaId, phoneNumberId } = downloadMediaPayload.parse(rawPayload);

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, mediaStatus: true, mimeType: true },
  });
  if (!message || message.mediaStatus === "READY") return;

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { phoneNumberId },
    select: { accessToken: true },
  });
  if (!connection) {
    throw new Error(`No hay conexión de WhatsApp para phone_number_id ${phoneNumberId}`);
  }

  const accessToken = decrypt(connection.accessToken);
  const { url, mimeType: resolvedMime } = await getMediaUrl({ mediaId, accessToken });
  const buffer = await downloadMedia({ url, accessToken });
  const mimeType = message.mimeType ?? resolvedMime;
  const mediaUrl = await saveMediaFile(buffer, mimeType);

  await prisma.message.update({
    where: { id: messageId },
    data: { mediaUrl, mimeType, mediaStatus: "READY" },
  });
}

/** Se llama cuando se agotaron los reintentos, para reflejarlo en la bandeja. */
export async function markMediaFailed(rawPayload: unknown): Promise<void> {
  const parsed = downloadMediaPayload.safeParse(rawPayload);
  if (!parsed.success) return;

  await prisma.message.updateMany({
    where: { id: parsed.data.messageId, mediaStatus: "PENDING" },
    data: { mediaStatus: "FAILED" },
  });
}
