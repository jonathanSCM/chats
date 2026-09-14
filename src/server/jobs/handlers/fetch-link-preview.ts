import { z } from "zod";
import { prisma } from "@/server/db/client";
import { getLinkPreview } from "@/server/services/link-preview";
import { firstUrl } from "@/lib/urls";

export const fetchLinkPreviewPayload = z.object({
  messageId: z.string(),
});

/**
 * Completa linkPreviewTitle/Description/ImageUrl del primer link del
 * mensaje -- corre aparte del webhook/envío para no bloquearlos con un
 * fetch a un servidor de terceros que puede tardar o fallar. Best-effort:
 * si no hay preview usable, el mensaje se queda igual, sin reintentos
 * infinitos (no es un dato crítico).
 */
export async function handleFetchLinkPreview(rawPayload: unknown): Promise<void> {
  const { messageId } = fetchLinkPreviewPayload.parse(rawPayload);

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { content: true },
  });
  if (!message) return;

  const url = firstUrl(message.content);
  if (!url) return;

  const preview = await getLinkPreview(url);
  if (!preview) return;

  await prisma.message.update({
    where: { id: messageId },
    data: {
      linkPreviewTitle: preview.title,
      linkPreviewDescription: preview.description,
      linkPreviewImageUrl: preview.imageUrl,
    },
  });
}
