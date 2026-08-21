"use server";

import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { decrypt } from "@/lib/crypto";
import {
  sendTextMessage,
  sendMediaMessage,
  sendTemplateMessage,
  uploadMedia,
  type OutboundMediaType,
} from "@/server/services/whatsapp";
import { saveMediaFile } from "@/lib/media-storage";
import { isWhatsAppAudioType, transcodeToOpus } from "@/lib/audio-transcode";

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

  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  if (!isAdmin) {
    const hasBotAccess = await prisma.botMember.findUnique({
      where: { botId_userId: { botId: conversation.botId, userId: session.user.id } },
    });
    if (!hasBotAccess) return null;
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
  let buffer = Buffer.from(await file.arrayBuffer());
  let mimeType = file.type || "application/octet-stream";
  let fileName = file.name;
  const outboundType = outboundTypeForMime(mimeType);

  const maxSize = MAX_SIZE_BY_TYPE[outboundType];
  if (file.size > maxSize) {
    return { error: `El archivo supera el límite de ${Math.round(maxSize / 1024 / 1024)}MB de WhatsApp para este tipo.` };
  }

  // Chrome graba las notas de voz en audio/webm, que WhatsApp rechaza.
  // Se convierte a ogg/opus antes de subirla.
  if (outboundType === "audio" && !isWhatsAppAudioType(mimeType)) {
    try {
      buffer = await transcodeToOpus(buffer);
      mimeType = "audio/ogg";
      fileName = fileName.replace(/\.[^.]+$/, "") + ".ogg";
    } catch (error) {
      console.error("[inbox] No se pudo convertir el audio:", error);
      return { error: "No se pudo procesar el audio. Intenta de nuevo." };
    }
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
      fileName,
    });

    ({ messageId } = await sendMediaMessage({
      phoneNumberId: connection.phoneNumberId,
      accessToken,
      to: conversation.customerPhone,
      type: outboundType,
      mediaId,
      caption: caption || undefined,
      fileName,
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
        // Lo saliente ya se subió aquí mismo: no pasa por la cola.
        mediaStatus: "READY",
        mimeType,
        fileName,
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

const templateSchema = z.object({
  templateName: z.string().min(1),
  languageCode: z.string().min(1),
  bodyParams: z.array(z.string().max(1000)).max(10),
  // El texto ya armado (placeholders {{1}}, {{2}}... reemplazados), para
  // guardarlo tal cual en el historial — así se lee igual que cualquier
  // otro mensaje, sin tener que volver a pedirle la plantilla a Meta.
  renderedContent: z.string().min(1).max(4000),
});

/**
 * Manda una plantilla aprobada por Meta — el único tipo de mensaje que se
 * puede iniciar fuera de la ventana de 24h desde el último mensaje del
 * cliente (ver services/whatsapp.ts).
 */
export async function sendTemplateMessageAction(
  conversationId: string,
  input: { templateName: string; languageCode: string; bodyParams: string[]; renderedContent: string },
): Promise<{ error: string | null }> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { error: "Datos de la plantilla inválidos" };

  const conversation = await getOwnedConversation(conversationId);
  if (!conversation) return { error: "Conversación no encontrada" };

  const connection = conversation.bot.whatsappConnection;
  if (!connection?.verified) {
    return { error: "WhatsApp no está conectado." };
  }

  let messageId: string | null;
  try {
    ({ messageId } = await sendTemplateMessage({
      phoneNumberId: connection.phoneNumberId,
      accessToken: decrypt(connection.accessToken),
      to: conversation.customerPhone,
      templateName: parsed.data.templateName,
      languageCode: parsed.data.languageCode,
      bodyParams: parsed.data.bodyParams,
    }));
  } catch (error) {
    console.error(error);
    return { error: "No se pudo enviar la plantilla por WhatsApp." };
  }

  const session = await requireSession();

  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        role: "STAFF",
        content: parsed.data.renderedContent,
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
