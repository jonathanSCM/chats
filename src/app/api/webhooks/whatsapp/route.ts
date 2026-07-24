import { NextRequest, NextResponse } from "next/server";
import { isValidWebhookSignature, parseInboundPayload } from "@/server/services/whatsapp";
import { handleIncomingMessage } from "@/server/services/conversation";

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

// Recepción de eventos (mensajes entrantes). Se procesa directamente aquí
// (sin cola/worker aparte): esta variante solo guarda el mensaje y, si trae
// media, la descarga — no hay llamada a un LLM que justifique desacoplar el
// trabajo pesado a un proceso de fondo.
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

  const messages = parseInboundPayload(payload);

  for (const message of messages) {
    try {
      await handleIncomingMessage(message);
    } catch (error) {
      console.error("[webhook] Error procesando mensaje entrante:", error);
    }
  }

  return new NextResponse("OK", { status: 200 });
}
