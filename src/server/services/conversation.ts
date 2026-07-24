import { prisma } from "@/server/db/client";
import { decrypt } from "@/lib/crypto";
import { getMediaUrl, downloadMedia, type ParsedInboundMessage } from "@/server/services/whatsapp";
import { saveMediaFile } from "@/lib/media-storage";

const CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000; // ventana de conversación de WhatsApp

const MEDIA_TYPE_MAP = {
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  document: "DOCUMENT",
} as const;

// Este proyecto es una bandeja de conversaciones humana: no hay bots ni
// respuestas automáticas. Cada mensaje entrante (texto o media) se guarda
// tal cual, y alguien del equipo responde desde el inbox.
export async function handleIncomingMessage(inbound: ParsedInboundMessage): Promise<void> {
  const connection = await prisma.whatsAppConnection.findUnique({
    where: { phoneNumberId: inbound.phoneNumberId },
    include: { bot: { include: { organization: true } } },
  });

  if (!connection) return;

  const accessToken = decrypt(connection.accessToken);
  const conversationId = await findOrCreateConversation(connection.bot.id, inbound.from);

  let mediaUrl: string | null = null;
  let mediaType: (typeof MEDIA_TYPE_MAP)[keyof typeof MEDIA_TYPE_MAP] | null = null;
  let mimeType: string | null = null;

  if (inbound.media) {
    try {
      const { url, mimeType: resolvedMime } = await getMediaUrl({
        mediaId: inbound.media.mediaId,
        accessToken,
      });
      const buffer = await downloadMedia({ url, accessToken });
      mediaUrl = await saveMediaFile(buffer, inbound.media.mimeType ?? resolvedMime);
      mediaType = MEDIA_TYPE_MAP[inbound.media.type];
      mimeType = inbound.media.mimeType ?? resolvedMime;
    } catch (error) {
      console.error("[conversation] Error descargando media entrante:", error);
    }
  }

  await prisma.message.create({
    data: {
      conversationId,
      role: "CUSTOMER",
      content: inbound.text ?? "",
      mediaUrl,
      mediaType,
      mimeType,
      fileName: inbound.media?.fileName ?? null,
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });
}

async function findOrCreateConversation(botId: string, customerPhone: string): Promise<string> {
  const existing = await prisma.conversation.findFirst({
    where: { botId, customerPhone },
    orderBy: { lastMessageAt: "desc" },
  });

  const withinWindow =
    existing && Date.now() - existing.lastMessageAt.getTime() < CONVERSATION_WINDOW_MS;

  if (withinWindow) return existing.id;

  const created = await prisma.conversation.create({
    data: { botId, customerPhone, billed: true, botPaused: true },
  });
  return created.id;
}
