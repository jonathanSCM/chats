import { NextRequest, NextResponse } from "next/server";
import { isValidWebhookSignature, parseInboundPayload } from "@/server/services/whatsapp";
import { getWhatsappInboundQueue } from "@/server/queue/whatsapp-inbound.queue";

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

// Recepción de eventos (mensajes entrantes). Debe responder rápido: solo
// valida, parsea y encola — el procesamiento real ocurre en el worker.
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
  const queue = getWhatsappInboundQueue();

  await Promise.all(
    messages.map((message) =>
      queue.add("inbound-message", message, {
        jobId: message.messageId, // idempotencia: Meta puede reenviar el mismo evento
      }),
    ),
  );

  return new NextResponse("OK", { status: 200 });
}
