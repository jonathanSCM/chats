import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import type {
  ParsedInboundMessage,
  ParsedEcho,
  ParsedHistoryBatch,
  ParsedContactSync,
  ParsedStatusUpdate,
} from "@/server/services/whatsapp";
import { notifyNewMessage } from "@/server/services/push";
import { enqueue } from "@/server/jobs";

const CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000; // ventana de conversación de WhatsApp
const FREE_ENTRY_POINT_MS = 72 * 60 * 60 * 1000; // gracia extra de Meta para leads de anuncios

/**
 * Si esta conversación vino de un anuncio "Click to WhatsApp" y todavía no
 * se activó la ventana extendida, y estamos respondiendo dentro de las 24h
 * normales desde ese primer mensaje, se activan 72h de gracia sin plantilla
 * (Meta: "free entry point conversation"). Se llama cada vez que el equipo
 * manda un mensaje — no hace nada si ya se activó o no aplica.
 */
export async function maybeActivateFreeEntryPoint(conversationId: string): Promise<void> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { adReferral: true, adReferralAt: true, freeEntryPointUntil: true },
  });
  if (!conv || !conv.adReferral || !conv.adReferralAt || conv.freeEntryPointUntil) return;
  if (Date.now() - conv.adReferralAt.getTime() > CONVERSATION_WINDOW_MS) return;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { freeEntryPointUntil: new Date(Date.now() + FREE_ENTRY_POINT_MS) },
  });
}

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

  const conversationId = await findOrCreateConversation(
    connection.bot.id,
    inbound.from,
    inbound.customerName,
    inbound.fromAd,
  );

  // El mensaje se guarda de inmediato para que aparezca en la bandeja al
  // instante; el archivo se descarga después en un job (tarda segundos y
  // Meta reintenta el webhook si tardamos en responder).
  let messageId: string;
  try {
    const created = await prisma.message.create({
      data: {
        conversationId,
        role: "CUSTOMER",
        content: inbound.text ?? "",
        mediaType: inbound.media ? MEDIA_TYPE_MAP[inbound.media.type] : null,
        mediaStatus: inbound.media ? "PENDING" : null,
        mimeType: inbound.media?.mimeType ?? null,
        fileName: inbound.media?.fileName ?? null,
        externalId: inbound.messageId,
      },
      select: { id: true },
    });
    messageId = created.id;
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

  if (inbound.media) {
    await enqueue({
      type: "download_media",
      uniqueKey: `download_media:${messageId}`,
      payload: {
        messageId,
        mediaId: inbound.media.mediaId,
        phoneNumberId: inbound.phoneNumberId,
      },
    });
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

/**
 * Ficha de CRM del cliente. Se identifica por teléfono dentro de la
 * organización, así que el mismo número nunca genera contactos duplicados
 * aunque abra varias conversaciones (manual §14).
 */
async function findOrCreateContact(params: {
  organizationId: string;
  phone: string;
  name?: string | null;
}): Promise<string> {
  const { organizationId, phone, name } = params;

  const existing = await prisma.contact.findUnique({
    where: { organizationId_phone: { organizationId, phone } },
    select: { id: true, fullName: true },
  });

  if (existing) {
    await prisma.contact.update({
      where: { id: existing.id },
      data: {
        lastContactAt: new Date(),
        // Solo se rellena si estaba vacío: lo que edite el vendedor a mano
        // manda sobre el nombre de perfil de WhatsApp.
        ...(name && !existing.fullName ? { fullName: name } : {}),
      },
    });
    return existing.id;
  }

  const created = await prisma.contact.create({
    data: {
      organizationId,
      phone,
      fullName: name ?? null,
      source: "whatsapp",
      lastContactAt: new Date(),
    },
    select: { id: true },
  });
  return created.id;
}

async function findOrCreateConversation(
  botId: string,
  customerPhone: string,
  customerName?: string | null,
  fromAd?: boolean,
): Promise<string> {
  const existing = await prisma.conversation.findFirst({
    where: { botId, customerPhone },
    orderBy: { lastMessageAt: "desc" },
  });

  const withinWindow =
    existing && Date.now() - existing.lastMessageAt.getTime() < CONVERSATION_WINDOW_MS;

  if (withinWindow) {
    // El perfil de WhatsApp puede cambiar de nombre; se refresca si vino uno nuevo.
    // Si todavía no se había marcado como venida de un anuncio y este
    // mensaje sí trae el "referral", se marca ahora (mismo hilo de 24h).
    if (
      (customerName && customerName !== existing.customerName) ||
      (fromAd && !existing.adReferral)
    ) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: {
          ...(customerName && customerName !== existing.customerName ? { customerName } : {}),
          ...(fromAd && !existing.adReferral ? { adReferral: true, adReferralAt: new Date() } : {}),
        },
      });
    }
    return existing.id;
  }

  const bot = await prisma.bot.findUniqueOrThrow({
    where: { id: botId },
    select: { organizationId: true },
  });
  const contactId = await findOrCreateContact({
    organizationId: bot.organizationId,
    phone: customerPhone,
    name: customerName,
  });

  const created = await prisma.conversation.create({
    data: {
      botId,
      customerPhone,
      customerName: customerName ?? null,
      contactId,
      billed: true,
      botPaused: true,
      ...(fromAd ? { adReferral: true, adReferralAt: new Date() } : {}),
    },
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

  let messageId: string;
  try {
    const created = await prisma.message.create({
      data: {
        conversationId,
        role: "STAFF",
        content: echo.text ?? "",
        mediaType: echo.media ? MEDIA_TYPE_MAP[echo.media.type] : null,
        mediaStatus: echo.media ? "PENDING" : null,
        mimeType: echo.media?.mimeType ?? null,
        fileName: echo.media?.fileName ?? null,
        externalId: echo.messageId,
        viaPhoneApp: true,
      },
      select: { id: true },
    });
    messageId = created.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }

  if (echo.media) {
    await enqueue({
      type: "download_media",
      uniqueKey: `download_media:${messageId}`,
      payload: {
        messageId,
        mediaId: echo.media.mediaId,
        phoneNumberId: echo.phoneNumberId,
      },
    });
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), botPaused: true },
  });
  await maybeActivateFreeEntryPoint(conversationId);
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

  await prisma.message.update({
    where: { id: message.id },
    data: {
      status: newStatus,
      ...(newStatus === "FAILED" ? { errorDetail: update.errorDetail } : {}),
    },
  });
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
