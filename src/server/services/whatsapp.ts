import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const GRAPH_API_VERSION = "v21.0";

// ─── Verificación de firma (Meta firma el body crudo con el App Secret) ────

export function isValidWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  // En desarrollo sin secret configurado, acepta todo (testing local)
  if (!appSecret) return true;

  if (!signatureHeader) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.replace("sha256=", "");

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}

// ─── Parseo del payload entrante ────────────────────────────────

const mediaObjectSchema = z.object({
  id: z.string(),
  mime_type: z.string().optional(),
  filename: z.string().optional(),
  caption: z.string().optional(),
});

const inboundSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            metadata: z.object({
              phone_number_id: z.string(),
            }),
            messages: z
              .array(
                z.object({
                  from: z.string(),
                  id: z.string(),
                  timestamp: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                  image: mediaObjectSchema.optional(),
                  video: mediaObjectSchema.optional(),
                  audio: mediaObjectSchema.optional(),
                  document: mediaObjectSchema.optional(),
                }),
              )
              .optional(),
          }),
        }),
      ),
    }),
  ),
});

export type InboundMediaType = "image" | "video" | "audio" | "document";

export interface ParsedInboundMessage {
  phoneNumberId: string;
  from: string;
  messageId: string;
  text: string | null;
  media: {
    type: InboundMediaType;
    mediaId: string;
    mimeType?: string;
    fileName?: string;
  } | null;
}

const MEDIA_TYPES: InboundMediaType[] = ["image", "video", "audio", "document"];

export function parseInboundPayload(payload: unknown): ParsedInboundMessage[] {
  const parsed = inboundSchema.safeParse(payload);
  if (!parsed.success) return [];

  const results: ParsedInboundMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const { phone_number_id } = change.value.metadata;
      for (const message of change.value.messages ?? []) {
        if (message.type === "text" && message.text?.body) {
          results.push({
            phoneNumberId: phone_number_id,
            from: message.from,
            messageId: message.id,
            text: message.text.body,
            media: null,
          });
          continue;
        }

        const mediaType = MEDIA_TYPES.find((t) => t === message.type);
        if (mediaType) {
          const mediaObj = message[mediaType];
          if (mediaObj) {
            results.push({
              phoneNumberId: phone_number_id,
              from: message.from,
              messageId: message.id,
              text: mediaObj.caption ?? null,
              media: {
                type: mediaType,
                mediaId: mediaObj.id,
                mimeType: mediaObj.mime_type,
                fileName: mediaObj.filename,
              },
            });
          }
        }
      }
    }
  }
  return results;
}

// ─── Envío de mensajes ──────────────────────────────────────────

export async function sendTextMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
}): Promise<void> {
  const { phoneNumberId, accessToken, to, body } = params;

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${errorBody}`);
  }
}

// ─── Media: descarga de lo entrante, subida/envío de lo saliente ──

export async function getMediaUrl(params: {
  mediaId: string;
  accessToken: string;
}): Promise<{ url: string; mimeType: string }> {
  const { mediaId, accessToken } = params;
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`No se pudo resolver el media (${res.status})`);
  const data = (await res.json()) as { url: string; mime_type: string };
  return { url: data.url, mimeType: data.mime_type };
}

export async function downloadMedia(params: {
  url: string;
  accessToken: string;
}): Promise<Buffer> {
  const res = await fetch(params.url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!res.ok) throw new Error(`No se pudo descargar el media (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function uploadMedia(params: {
  phoneNumberId: string;
  accessToken: string;
  file: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  const { phoneNumberId, accessToken, file, mimeType, fileName } = params;

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([new Uint8Array(file)], { type: mimeType }), fileName);

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/media`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo subir el media (${res.status}): ${errorBody}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

export type OutboundMediaType = "image" | "video" | "audio" | "document";

export async function sendMediaMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  type: OutboundMediaType;
  mediaId: string;
  caption?: string;
  fileName?: string;
}): Promise<void> {
  const { phoneNumberId, accessToken, to, type, mediaId, caption, fileName } = params;

  const mediaPayload: Record<string, unknown> = { id: mediaId };
  if (caption && (type === "image" || type === "video" || type === "document")) {
    mediaPayload.caption = caption;
  }
  if (fileName && type === "document") {
    mediaPayload.filename = fileName;
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type,
        [type]: mediaPayload,
      }),
    },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`WhatsApp send media failed (${res.status}): ${errorBody}`);
  }
}

// ─── Verificación de conexión ───────────────────────────────────

export async function verifyPhoneNumber(params: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<{ verifiedName: string; displayNumber: string }> {
  const { phoneNumberId, accessToken } = params;

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}?fields=verified_name,display_phone_number`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo verificar el número (${res.status}): ${errorBody}`);
  }

  const data = (await res.json()) as { verified_name?: string; display_phone_number?: string };
  return {
    verifiedName: data.verified_name ?? "Sin nombre verificado",
    displayNumber: data.display_phone_number ?? "",
  };
}
