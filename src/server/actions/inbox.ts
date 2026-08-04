"use server";

import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { decrypt } from "@/lib/crypto";
import { sendTextMessage, sendMediaMessage, uploadMedia, type OutboundMediaType } from "@/server/services/whatsapp";
import { saveMediaFile } from "@/lib/media-storage";

const messageSchema = z.object({ content: z.string().min(1).max(4000) });

async function getOwnedConversation(conversationId: string) {
  const session = await requireSession();
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { bot: { include: { whatsappConnection: true } } },
  });
  if (!conversation || conversation.bot.organizationId !== session.user.organizationId) {
    return null;
  }
  return conversation;
}

export async function sendInboxMessageAction(
  conversationId: string,
  content: string,
): Promise<{ error: string | null }> {
  const parsed = messageSchema.safeParse({ content });
  if (!parsed.success) {
    return { error: "Mensaje inválido" };
  }

  const conversation = await getOwnedConversation(conversationId);
  if (!conversation) return { error: "Conversación no encontrada" };

  const connection = conversation.bot.whatsappConnection;
  if (!connection?.verified) {
    return { error: "WhatsApp no está conectado." };
  }

  let messageId: string | null;
  try {
    ({ messageId } = await sendTextMessage({
      phoneNumberId: connection.phoneNumberId,
      accessToken: decrypt(connection.accessToken),
      to: conversation.customerPhone,
      body: parsed.data.content,
    }));
  } catch (error) {
    console.error(error);
    return { error: "No se pudo enviar el mensaje por WhatsApp." };
  }

  const session = await requireSession();

  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        role: "STAFF",
        content: parsed.data.content,
        sentById: session.user.id,
        externalId: messageId,
      },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), botPaused: true },
    }),
    // Auto-asignación: si nadie la tenía, el primero que responde se queda con ella.
    prisma.conversation.updateMany({
      where: { id: conversationId, assignedToId: null },
      data: { assignedToId: session.user.id },
    }),
  ]);

  return { error: null };
}

const MEDIA_TYPE_MAP = {
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  document: "DOCUMENT",
} as const;

function outboundTypeForMime(mimeType: string): OutboundMediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

// Límites de tamaño de Meta por tipo de media (WhatsApp Cloud API).
const MAX_SIZE_BY_TYPE: Record<OutboundMediaType, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

export async function sendInboxAttachmentAction(
  conversationId: string,
  formData: FormData,
): Promise<{ error: string | null }> {
  const conversation = await getOwnedConversation(conversationId);
  if (!conversation) return { error: "Conversación no encontrada" };

  const connection = conversation.bot.whatsappConnection;
  if (!connection?.verified) {
    return { error: "WhatsApp no está conectado." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "Archivo inválido" };
  }

  const caption = (formData.get("caption") as string | null) ?? "";
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const outboundType = outboundTypeForMime(mimeType);

  const maxSize = MAX_SIZE_BY_TYPE[outboundType];
  if (file.size > maxSize) {
    return { error: `El archivo supera el límite de ${Math.round(maxSize / 1024 / 1024)}MB de WhatsApp para este tipo.` };
  }

  const accessToken = decrypt(connection.accessToken);

  let mediaId: string;
  let messageId: string | null;
  try {
    mediaId = await uploadMedia({
      phoneNumberId: connection.phoneNumberId,
      accessToken,
      file: buffer,
      mimeType,
      fileName: file.name,
    });

    ({ messageId } = await sendMediaMessage({
      phoneNumberId: connection.phoneNumberId,
      accessToken,
      to: conversation.customerPhone,
      type: outboundType,
      mediaId,
      caption: caption || undefined,
      fileName: file.name,
    }));
  } catch (error) {
    console.error(error);
    return { error: "No se pudo enviar el archivo por WhatsApp." };
  }

  const localUrl = await saveMediaFile(buffer, mimeType);
  const session = await requireSession();

  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        role: "STAFF",
        content: caption,
        mediaUrl: localUrl,
        mediaType: MEDIA_TYPE_MAP[outboundType],
        mimeType,
        fileName: file.name,
        sentById: session.user.id,
        externalId: messageId,
      },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), botPaused: true },
    }),
    prisma.conversation.updateMany({
      where: { id: conversationId, assignedToId: null },
      data: { assignedToId: session.user.id },
    }),
  ]);

  return { error: null };
}
