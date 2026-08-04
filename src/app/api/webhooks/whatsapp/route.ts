import { NextRequest, NextResponse } from "next/server";
import {
  isValidWebhookSignature,
  parseInboundPayload,
  parseMessageEchoes,
  parseHistoryPayload,
  parseContactSync,
} from "@/server/services/whatsapp";
import {
  handleIncomingMessage,
  handlePhoneAppEcho,
  handleHistoryImport,
  handleContactSync,
} from "@/server/services/conversation";

// Handshake de verificación que hace Meta al configurar el webhook.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// Recepción de eventos. Se procesa directamente aquí (sin cola/worker
// aparte): esta variante solo guarda el mensaje y, si trae media, la
// descarga — no hay llamada a un LLM que justifique desacoplar el trabajo
// pesado a un proceso de fondo.
//
// Un mismo POST puede traer varios tipos de evento mezclados (mensajes
// normales, ecos de la app del celular, historial, contactos) — cada
// parseXxx() filtra por su propio campo `field` e ignora el resto, así que
// es seguro llamarlos todos sobre el mismo payload.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!isValidWebhookSignature(rawBody, signature)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  // `next start` no loguea requests por default (a diferencia de `next dev`),
  // así que sin esto no hay forma de saber si Meta llegó a mandar el evento.
  console.log(
    "[webhook] POST recibido:",
    JSON.stringify(payload).slice(0, 2000),
  );

  const messages = parseInboundPayload(payload);
  console.log(`[webhook] ${messages.length} mensaje(s) parseado(s) del campo "messages"`);
  for (const message of messages) {
    try {
      await handleIncomingMessage(message);
      console.log(
        `[webhook] Mensaje ${message.messageId} procesado OK (${message.media ? message.media.type : "texto"})`,
      );
    } catch (error) {
      console.error("[webhook] Error procesando mensaje entrante:", error);
    }
  }

  const echoes = parseMessageEchoes(payload);
  for (const echo of echoes) {
    try {
      await handlePhoneAppEcho(echo);
    } catch (error) {
      console.error("[webhook] Error procesando eco de la app del celular:", error);
    }
  }

  const historyBatch = parseHistoryPayload(payload);
  if (historyBatch.messages.length > 0 || historyBatch.isComplete) {
    try {
      await handleHistoryImport(historyBatch);
    } catch (error) {
      console.error("[webhook] Error importando historial (coexistence):", error);
    }
  }

  const contacts = parseContactSync(payload);
  if (contacts.length > 0) {
    try {
      await handleContactSync(contacts);
    } catch (error) {
      console.error("[webhook] Error sincronizando contactos (coexistence):", error);
    }
  }

  return new NextResponse("OK", { status: 200 });
}
