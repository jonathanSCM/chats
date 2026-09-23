import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import type {
  ParsedInboundMessage,
  ParsedEcho,
  ParsedHistoryBatch,
  ParsedContactSync,
  ParsedStatusUpdate,
  ParsedReaction,
  AdReferralInfo,
} from "@/server/services/whatsapp";
import { googleMapsUrl, sendInteractiveListMessage, sendTextMessage, type InteractiveListRow } from "@/server/services/whatsapp";
import { notifyNewMessage } from "@/server/services/push";
import { enqueue, enqueueOrReschedule, runJobsSoon } from "@/server/jobs";
import { decrypt } from "@/lib/crypto";
import { resolveAdInfo } from "@/server/services/meta-ads";
import { getAvailableSlots } from "@/server/services/availability";
import { getZonedParts } from "@/lib/timezone";
import { firstUrl } from "@/lib/urls";

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

function locationLabel(location: { name: string | null; address: string | null }): string {
  return [location.name, location.address].filter(Boolean).join(", ") || "Ubicación compartida";
}

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
    inbound.adReferral,
    inbound.fromAd ? decrypt(connection.accessToken) : null,
  );

  // Mensaje sin contenido real (ver whatsapp.ts: tipos que Meta no nos deja
  // leer, típicamente el primer mensaje tras un anuncio en un número con
  // Coexistence) -- ya se registró la atribución de arriba, no hace falta
  // (ni conviene) dejar una burbuja vacía en la bandeja.
  if (!inbound.text && !inbound.media && !inbound.location) return;

  // Si este mensaje responde citando a otro, se busca por externalId -- si
  // todavía no lo tenemos (mensaje viejo no sincronizado, o llegó fuera de
  // orden), se guarda igual pero sin la cita en vez de fallar.
  const replyToId = inbound.replyToExternalId
    ? (
        await prisma.message.findUnique({
          where: { externalId: inbound.replyToExternalId },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  // El mensaje se guarda de inmediato para que aparezca en la bandeja al
  // instante; el archivo se descarga después en un job (tarda segundos y
  // Meta reintenta el webhook si tardamos en responder).
  let messageId: string;
  try {
    const created = await prisma.message.create({
      data: {
        conversationId,
        role: "CUSTOMER",
        content: inbound.location ? locationLabel(inbound.location) : inbound.text ?? "",
        mediaType: inbound.location
          ? "LOCATION"
          : inbound.media
            ? MEDIA_TYPE_MAP[inbound.media.type]
            : null,
        // La ubicación no descarga nada de Meta -- mediaUrl ya queda con el
        // link final de Google Maps, así que nunca pasa por "PENDING".
        mediaStatus: inbound.media ? "PENDING" : null,
        mediaUrl: inbound.location ? googleMapsUrl(inbound.location.latitude, inbound.location.longitude) : null,
        mimeType: inbound.media?.mimeType ?? null,
        fileName: inbound.media?.fileName ?? null,
        externalId: inbound.messageId,
        replyToId,
        isVoiceNote: inbound.media?.isVoiceNote ?? false,
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

  if (inbound.text && firstUrl(inbound.text)) {
    await enqueue({
      type: "fetch_link_preview",
      uniqueKey: `fetch_link_preview:${messageId}`,
      payload: { messageId },
    });
  }

  const conversation = await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
    select: {
      assignedToId: true,
      customerName: true,
      customerPhone: true,
      botPaused: true,
      muted: true,
    },
  });

  const preview = inbound.text ?? (inbound.media ? MEDIA_PREVIEW[inbound.media.type] : "");
  if (!conversation.muted) {
    await notifyNewMessage({
      conversationId,
      organizationId: connection.bot.organizationId,
      assignedToId: conversation.assignedToId,
      customerLabel: conversation.customerName || conversation.customerPhone,
      preview,
    }).catch((error) => console.error("[conversation] Error notificando por push:", error));
  }

  // Respuesta a la lista de prueba de horarios (ver sendTestAvailabilityListAction
  // en inbox.ts) -- se identifica por el prefijo del id, no por el contenido
  // del mensaje, así que no hay ambigüedad con nada que escriba un cliente
  // real. No dispara el bot de calificación normal: es un flujo aparte,
  // deliberadamente, mientras se prueba antes de engancharlo de verdad.
  if (inbound.interactiveReply?.id.startsWith("testday:") || inbound.interactiveReply?.id.startsWith("testslot:")) {
    await handleTestBookingReply(conversationId, connection, inbound.interactiveReply.id);
    return;
  }

  // El bot de calificación contesta solo si está habilitado para esta
  // cuenta, ningún humano tomó ya la conversación, y (si hay un teléfono de
  // prueba cargado) el mensaje viene de ese número. Se reprograma (no se
  // duplica) por conversación: si el cliente manda varios mensajes
  // seguidos, el bot responde una sola vez a todos juntos.
  const botActiveForThisPhone =
    connection.bot.aiQualificationEnabled &&
    (!connection.bot.aiTestPhone || connection.bot.aiTestPhone === conversation.customerPhone);
  if (botActiveForThisPhone && !conversation.botPaused) {
    const BOT_DEBOUNCE_MS = 5000;
    await enqueueOrReschedule({
      type: "bot_reply",
      uniqueKey: `bot_reply:${conversationId}`,
      payload: { conversationId },
      runAfter: new Date(Date.now() + BOT_DEBOUNCE_MS),
    });
    // runJobsSoon() de acá abajo no agarra este job (todavía no está
    // "runAfter"), y sin nadie más que lo despierte se queda esperando al
    // cron de cada 1 minuto — el bot tardaría hasta ~1 minuto en responder
    // en vez de ~5 segundos. Se programa un segundo llamado para después
    // del debounce; si mientras tanto llega otro mensaje y reprograma el
    // job más adelante, este timer no encuentra nada listo y no hace nada
    // (inofensivo) — el timer del último mensaje es el que efectivamente
    // lo despierta.
    setTimeout(() => runJobsSoon(), BOT_DEBOUNCE_MS + 500);
  }
}

/**
 * Segundo tramo del flujo de prueba: el cliente ya tocó una opción de la
 * primera lista (un día) o de la segunda (un horario dentro de ese día).
 * Distingue cuál por el prefijo del id -- "testday:" manda la lista de
 * horarios de ese día puntual (getAvailableSlots con onlyDateKey), y
 * "testslot:" solo confirma en el chat (todavía no crea una Meeting real,
 * a propósito, mientras esto sigue siendo una prueba).
 */
async function handleTestBookingReply(
  conversationId: string,
  connection: { phoneNumberId: string; accessToken: string; bot: { organizationId: string } },
  interactiveId: string,
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { customerPhone: true },
  });
  if (!conversation) return;

  const accessToken = decrypt(connection.accessToken);

  if (interactiveId.startsWith("testday:")) {
    const dateKey = interactiveId.slice("testday:".length);
    const slots = await getAvailableSlots(connection.bot.organizationId, 8, 30, dateKey);
    if (slots.length === 0) {
      const { messageId } = await sendTextMessage({
        phoneNumberId: connection.phoneNumberId,
        accessToken,
        to: conversation.customerPhone,
        body: "🧪 Ups, ese día ya no tiene horarios libres -- esto puede pasar si alguien más lo tomó justo ahora.",
      });
      await prisma.message.create({
        data: { conversationId, role: "BOT", content: "🧪 [Prueba] Día sin horarios al momento de elegirlo.", externalId: messageId },
      });
      return;
    }

    const rows: InteractiveListRow[] = slots.map((slot) => ({
      id: `testslot:${slot.date.toISOString()}`,
      title: slot.label.slice(0, 24),
    }));
    const { messageId } = await sendInteractiveListMessage({
      phoneNumberId: connection.phoneNumberId,
      accessToken,
      to: conversation.customerPhone,
      bodyText: "🧪 Perfecto, estos son los horarios libres ese día.",
      buttonText: "Ver horarios",
      sectionTitle: "Horarios disponibles",
      rows,
    });
    await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId,
          role: "BOT",
          content: `🧪 [Prueba] Lista de horarios enviada: ${slots.map((s) => s.label).join(" · ")}`,
          externalId: messageId,
        },
      }),
      prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }),
    ]);
    return;
  }

  // "testslot:" -- el cliente ya eligió un horario puntual. Solo confirma
  // visualmente por ahora; no crea una Meeting real (ver comentario arriba).
  const isoDate = interactiveId.slice("testslot:".length);
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: connection.bot.organizationId },
    select: { timezone: true },
  });
  // Con el huso de la organización, no el del servidor -- mismo criterio
  // que getAvailableSlots(), para que la hora mostrada sea la real.
  const parts = getZonedParts(new Date(isoDate), org.timezone);
  const label = `${parts.day}/${String(parts.month).padStart(2, "0")}, ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  const { messageId } = await sendTextMessage({
    phoneNumberId: connection.phoneNumberId,
    accessToken,
    to: conversation.customerPhone,
    body: `🧪 Prueba completa: elegiste ${label}. (Esto todavía no agenda una reunión real -- es solo para probar el flujo.)`,
  });
  await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, role: "BOT", content: `🧪 [Prueba] Horario elegido: ${label}`, externalId: messageId },
    }),
    prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }),
  ]);
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
  adReferral?: AdReferralInfo | null,
  /** Access token de la conexión de WhatsApp que recibió el mensaje -- se reusa para resolver el anuncio, ver meta-ads.ts. */
  accessToken?: string | null,
): Promise<string> {
  // El webhook de WhatsApp nunca manda el nombre del anuncio/campaña, solo
  // su ID (`sourceId`) -- se resuelve acá contra la Marketing API (ver
  // meta-ads.ts) antes de guardarlo. Se calcula una sola vez arriba, aunque
  // en el caso raro de una conversación ya marcada como venida de un
  // anuncio esto se termine descartando sin usar -- más simple que
  // duplicar la misma llamada en las dos ramas de abajo.
  const enrichedAdReferral =
    fromAd && adReferral?.sourceId && accessToken
      ? { ...adReferral, ...((await resolveAdInfo(adReferral.sourceId, accessToken)) ?? {}) }
      : adReferral;

  // Un mismo contacto es SIEMPRE el mismo chat en la bandeja, sin importar
  // cuánto tiempo pase entre mensajes -- igual que WhatsApp de verdad. Antes
  // esto se cortaba a las 24h (CONVERSATION_WINDOW_MS), heredado de cuando
  // `Conversation` representaba una unidad de facturación de la plataforma
  // SaaS original, no un hilo de chat. El resultado real en producción: si
  // un cliente volvía a escribir después de más de un día, se le creaba una
  // conversación NUEVA y separada, duplicando el chat en la lista. La
  // ventana de 24h de WhatsApp para poder mandar texto libre (vs. necesitar
  // plantilla) es un chequeo aparte, sin relación con esto -- se calcula en
  // api/inbox/conversations/[id]/messages/route.ts a partir del último
  // mensaje del cliente, no de esta función.
  const existing = await prisma.conversation.findFirst({
    where: { botId, customerPhone },
    orderBy: { lastMessageAt: "desc" },
  });

  if (existing) {
    // El perfil de WhatsApp puede cambiar de nombre; se refresca si vino uno nuevo.
    // Si todavía no se había marcado como venida de un anuncio y este
    // mensaje sí trae el "referral", se marca ahora.
    if (
      (customerName && customerName !== existing.customerName) ||
      (fromAd && !existing.adReferral)
    ) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: {
          ...(customerName && customerName !== existing.customerName ? { customerName } : {}),
          ...(fromAd && !existing.adReferral
            ? {
                adReferral: true,
                adReferralAt: new Date(),
                adReferralData: (enrichedAdReferral ?? undefined) as Prisma.InputJsonValue | undefined,
              }
            : {}),
        },
      });
    }
    return existing.id;
  }

  const bot = await prisma.bot.findUniqueOrThrow({
    where: { id: botId },
    select: { organizationId: true, aiQualificationEnabled: true, aiTestPhone: true },
  });
  const contactId = await findOrCreateContact({
    organizationId: bot.organizationId,
    phone: customerPhone,
    name: customerName,
  });

  // Si el bot de calificación está habilitado para esta cuenta, la
  // conversación arranca sin pausar para que pueda contestar el primer
  // mensaje. Si no, sigue naciendo pausada (bandeja 100% humana). Con un
  // teléfono de prueba cargado, solo arranca sin pausar para ESE número —
  // para todos los demás, aunque el bot esté activo, sigue siendo 100%
  // manual mientras se prueba.
  const botActiveForThisPhone =
    bot.aiQualificationEnabled && (!bot.aiTestPhone || bot.aiTestPhone === customerPhone);

  const created = await prisma.conversation.create({
    data: {
      botId,
      customerPhone,
      customerName: customerName ?? null,
      contactId,
      billed: true,
      botPaused: !botActiveForThisPhone,
      ...(fromAd
        ? {
            adReferral: true,
            adReferralAt: new Date(),
            adReferralData: (enrichedAdReferral ?? undefined) as Prisma.InputJsonValue | undefined,
          }
        : {}),
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

  if (batch.isComplete && batch.completedPhoneNumberId) {
    await prisma.whatsAppConnection.updateMany({
      where: { phoneNumberId: batch.completedPhoneNumberId },
      data: { historySyncStatus: "COMPLETE" },
    });
  }

  if (batch.declinedPhoneNumberId) {
    await prisma.whatsAppConnection.updateMany({
      where: { phoneNumberId: batch.declinedPhoneNumberId },
      data: { historySyncStatus: "DECLINED" },
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

/**
 * Reacción con emoji del cliente sobre un mensaje que ya existe -- nunca
 * crea un Message nuevo, solo actualiza `customerReaction` (calcado de
 * handleStatusUpdate de arriba). Si el mensaje citado todavía no está
 * sincronizado (raro, pero posible con reintentos de Meta), se ignora.
 */
export async function handleIncomingReaction(reaction: ParsedReaction): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { externalId: reaction.targetExternalId },
    select: { id: true },
  });
  if (!message) return;

  await prisma.message.update({
    where: { id: message.id },
    data: { customerReaction: reaction.emoji || null },
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
