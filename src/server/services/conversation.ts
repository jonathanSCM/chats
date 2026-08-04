import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { decrypt } from "@/lib/crypto";
import {
  getMediaUrl,
  downloadMedia,
  type ParsedInboundMessage,
  type ParsedEcho,
  type ParsedHistoryBatch,
  type ParsedContactSync,
  type ParsedStatusUpdate,
} from "@/server/services/whatsapp";
import { saveMediaFile } from "@/lib/media-storage";
import { notifyNewMessage } from "@/server/services/push";

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
  // Idempotencia: Meta puede reenviar el mismo evento si no confirmamos a
  // tiempo. Sin cola de por medio, la deduplicación vive en esta unicidad.
  const alreadyProcessed = await prisma.message.findUnique({
    where: { externalId: inbound.messageId },
    select: { id: true },
  });
  if (alreadyProcessed) return;

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { phoneNumberId: inbound.phoneNumberId },
    include: { bot: { include: { organization: true } } },
  });

  if (!connection) return;

  const accessToken = decrypt(connection.accessToken);
  const conversationId = await findOrCreateConversation(
    connection.bot.id,
    inbound.from,
    inbound.customerName,
  );

  let mediaUrl: string | null = null;
  let mediaType: (typeof MEDIA_TYPE_MAP)[keyof typeof MEDIA_TYPE_MAP] | null = null;
  let mimeType: string | null = null;

  let mediaFailed = false;
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
      mediaFailed = true;
      console.error(
        `[conversation] Error descargando media entrante (mensaje ${inbound.messageId}, tipo ${inbound.media.type}):`,
        error,
      );
    }
  }

  try {
    await prisma.message.create({
      data: {
        conversationId,
        role: "CUSTOMER",
        content:
          inbound.text ?? (mediaFailed ? "⚠️ No se pudo descargar el archivo adjunto." : ""),
        mediaUrl,
        mediaType,
        mimeType,
        fileName: inbound.media?.fileName ?? null,
        externalId: inbound.messageId,
      },
    });
  } catch (error) {
    // P2002 = violación de unicidad en externalId: dos requests casi
    // simultáneas para el mismo mensaje (Meta reintentando el webhook)
    // pasaron el chequeo de idempotencia de arriba antes de que la primera
    // terminara de escribir. La segunda no debe fallar ruidosamente — ya
    // se guardó, es exactamente lo que se buscaba evitar duplicar.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }

  const conversation = await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
    select: { assignedToId: true, customerName: true, customerPhone: true },
  });

  const preview = inbound.text ?? (inbound.media ? MEDIA_PREVIEW[inbound.media.type] : "");
  await notifyNewMessage({
    conversationId,
    organizationId: connection.bot.organizationId,
    assignedToId: conversation.assignedToId,
    customerLabel: conversation.customerName || conversation.customerPhone,
    preview,
  }).catch((error) => console.error("[conversation] Error notificando por push:", error));
}

const MEDIA_PREVIEW: Record<string, string> = {
  image: "📷 Foto",
  video: "🎥 Video",
  audio: "🎵 Audio",
  document: "📄 Documento",
};

async function findOrCreateConversation(
  botId: string,
  customerPhone: string,
  customerName?: string | null,
): Promise<string> {
  const existing = await prisma.conversation.findFirst({
    where: { botId, customerPhone },
    orderBy: { lastMessageAt: "desc" },
  });

  const withinWindow =
    existing && Date.now() - existing.lastMessageAt.getTime() < CONVERSATION_WINDOW_MS;

  if (withinWindow) {
    // El perfil de WhatsApp puede cambiar de nombre; se refresca si vino uno nuevo.
    if (customerName && customerName !== existing.customerName) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: { customerName },
      });
    }
    return existing.id;
  }

  const created = await prisma.conversation.create({
    data: { botId, customerPhone, customerName: customerName ?? null, billed: true, botPaused: true },
  });
  return created.id;
}

// ─── Coexistence: eco de un mensaje mandado desde la app del celular ────
//
// Cuando alguien del equipo responde con la app normal de WhatsApp Business
// (no desde este panel), Meta manda un "eco" del mensaje. Se guarda igual
// que si lo hubiéramos mandado desde aquí (role STAFF), marcado con
// viaPhoneApp para distinguirlo, y se pausa el bot — un humano ya está
// atendiendo esta conversación desde el celular.
export async function handlePhoneAppEcho(echo: ParsedEcho): Promise<void> {
  const alreadyProcessed = await prisma.message.findUnique({
    where: { externalId: echo.messageId },
    select: { id: true },
  });
  if (alreadyProcessed) return;

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { phoneNumberId: echo.phoneNumberId },
    include: { bot: true },
  });
  if (!connection) return;

  const conversationId = await findOrCreateConversation(connection.bot.id, echo.to);

  let mediaUrl: string | null = null;
  let mediaType: (typeof MEDIA_TYPE_MAP)[keyof typeof MEDIA_TYPE_MAP] | null = null;
  let mimeType: string | null = null;

  let mediaFailed = false;
  if (echo.media) {
    try {
      const accessToken = decrypt(connection.accessToken);
      const { url, mimeType: resolvedMime } = await getMediaUrl({
        mediaId: echo.media.mediaId,
        accessToken,
      });
      const buffer = await downloadMedia({ url, accessToken });
      mediaUrl = await saveMediaFile(buffer, echo.media.mimeType ?? resolvedMime);
      mediaType = MEDIA_TYPE_MAP[echo.media.type];
      mimeType = echo.media.mimeType ?? resolvedMime;
    } catch (error) {
      mediaFailed = true;
      console.error(
        `[conversation] Error descargando media de un eco (mensaje ${echo.messageId}, tipo ${echo.media.type}):`,
        error,
      );
    }
  }

  try {
    await prisma.message.create({
      data: {
        conversationId,
        role: "STAFF",
        content: echo.text ?? (mediaFailed ? "⚠️ No se pudo descargar el archivo adjunto." : ""),
        mediaUrl,
        mediaType,
        mimeType,
        fileName: echo.media?.fileName ?? null,
        externalId: echo.messageId,
        viaPhoneApp: true,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), botPaused: true },
  });
}

// ─── Coexistence: import del historial previo a conectar ───────────────
//
// Meta manda el historial en varios chunks (mismo phone_number_id, varios
// webhooks seguidos); se van insertando a medida que llegan, marcados como
// isHistorical para distinguirlos visualmente si hace falta. Al llegar el
// chunk con phase "complete", se marca la conexión como historySyncStatus
// COMPLETE.
export async function handleHistoryImport(batch: ParsedHistoryBatch): Promise<void> {
  for (const message of batch.messages) {
    const connection = await prisma.whatsAppConnection.findUnique({
      where: { phoneNumberId: message.phoneNumberId },
      include: { bot: true },
    });
    if (!connection) continue;

    const conversationId = await findOrCreateConversation(connection.bot.id, message.customerPhone);

    try {
      await prisma.message.create({
        data: {
          conversationId,
          role: message.fromBusiness ? "STAFF" : "CUSTOMER",
          content: message.text ?? "",
          externalId: message.messageId,
          isHistorical: true,
          createdAt: new Date(Number(message.timestamp) * 1000),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }

  if (batch.isComplete && batch.messages.length > 0) {
    await prisma.whatsAppConnection.updateMany({
      where: { phoneNumberId: batch.messages[0].phoneNumberId },
      data: { historySyncStatus: "COMPLETE" },
    });
  }
}

// ─── Confirmaciones de entrega/lectura de mensajes salientes ────────────
//
// Meta manda "sent" -> "delivered" -> "read" en orden, pero por si llega
// alguno fuera de orden (reintentos, red), solo avanza el status, nunca
// retrocede (un mensaje ya leído no debería volver a "entregado").
const STATUS_RANK: Record<string, number> = { SENT: 0, DELIVERED: 1, READ: 2, FAILED: 3 };

export async function handleStatusUpdate(update: ParsedStatusUpdate): Promise<void> {
  const newStatus = update.status.toUpperCase() as "SENT" | "DELIVERED" | "READ" | "FAILED";

  const message = await prisma.message.findUnique({
    where: { externalId: update.messageId },
    select: { id: true, status: true },
  });
  if (!message) return; // mensaje mandado antes de este cambio, o de otra org

  if (STATUS_RANK[newStatus] <= STATUS_RANK[message.status]) return;

  await prisma.message.update({ where: { id: message.id }, data: { status: newStatus } });
}

// ─── Coexistence: sincronización de contactos del negocio ───────────────
//
// Le pone nombre a las conversaciones existentes con ese número — es solo
// para mostrar mejor en el inbox, no crea conversaciones nuevas por sí solo.
export async function handleContactSync(contacts: ParsedContactSync[]): Promise<void> {
  for (const contact of contacts) {
    const connection = await prisma.whatsAppConnection.findUnique({
      where: { phoneNumberId: contact.phoneNumberId },
      select: { botId: true },
    });
    if (!connection || !contact.name) continue;

    await prisma.conversation.updateMany({
      where: { botId: connection.botId, customerPhone: contact.contactPhone },
      data: { customerName: contact.name },
    });
  }
}
