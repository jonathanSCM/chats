import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const GRAPH_API_VERSION = "v21.0";

// ─── Verificación de firma (Meta firma el body crudo con el App Secret) ────

export function isValidWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appSecret) {
    // En producción esto es un error de configuración, no un modo válido:
    // sin secret, cualquiera podría mandar webhooks falsos haciéndose pasar
    // por Meta. Solo se permite en desarrollo, para probar sin credenciales.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[whatsapp] WHATSAPP_APP_SECRET no está configurada en producción — rechazando el webhook.",
      );
      return false;
    }
    return true;
  }

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
          field: z.string().optional(),
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
            statuses: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.string(), // "sent" | "delivered" | "read" | "failed"
                  timestamp: z.string(),
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

// Meta manda varios tipos de evento por el mismo webhook, distinguidos por
// `field` dentro de cada change: "messages" (normal), "smb_message_echoes"
// (coexistence: alguien respondió desde la app del celular), "history"
// (coexistence: import inicial de conversaciones viejas) y
// "smb_app_state_sync" (coexistence: contactos del negocio). Cada
// parseXxx() de abajo filtra por su propio `field` e ignora el resto.
function isFieldMatch(field: unknown, expected: string): boolean {
  // Si el evento no trae `field` (algunos payloads de prueba lo omiten),
  // se asume "messages" por compatibilidad — es el caso histórico/normal.
  if (field === undefined) return expected === "messages";
  return field === expected;
}

export function parseInboundPayload(payload: unknown): ParsedInboundMessage[] {
  const parsed = inboundSchema.safeParse(payload);
  if (!parsed.success) return [];

  const results: ParsedInboundMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (!isFieldMatch(change.field, "messages")) continue;
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

export interface ParsedStatusUpdate {
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
}

// Confirmaciones de entrega/lectura de los mensajes que mandamos nosotros
// (los "check azul") — vienen en el mismo campo "messages" del webhook,
// mezcladas con los mensajes entrantes, distinguidas por venir en `statuses`
// en vez de `messages`.
export function parseStatusUpdates(payload: unknown): ParsedStatusUpdate[] {
  const parsed = inboundSchema.safeParse(payload);
  if (!parsed.success) return [];

  const results: ParsedStatusUpdate[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (!isFieldMatch(change.field, "messages")) continue;
      for (const status of change.value.statuses ?? []) {
        if (["sent", "delivered", "read", "failed"].includes(status.status)) {
          results.push({
            messageId: status.id,
            status: status.status as ParsedStatusUpdate["status"],
          });
        }
      }
    }
  }
  return results;
}

// ─── Coexistence: ecos de mensajes mandados desde la app del celular ────

const echoSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string().optional(),
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }),
            message_echoes: z
              .array(
                z.object({
                  from: z.string(),
                  to: z.string(),
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

export interface ParsedEcho {
  phoneNumberId: string;
  to: string; // número del cliente
  messageId: string;
  text: string | null;
  media: {
    type: InboundMediaType;
    mediaId: string;
    mimeType?: string;
    fileName?: string;
  } | null;
}

export function parseMessageEchoes(payload: unknown): ParsedEcho[] {
  const parsed = echoSchema.safeParse(payload);
  if (!parsed.success) return [];

  const results: ParsedEcho[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (!isFieldMatch(change.field, "smb_message_echoes")) continue;
      const { phone_number_id } = change.value.metadata;
      for (const echo of change.value.message_echoes ?? []) {
        if (echo.type === "text" && echo.text?.body) {
          results.push({
            phoneNumberId: phone_number_id,
            to: echo.to,
            messageId: echo.id,
            text: echo.text.body,
            media: null,
          });
          continue;
        }
        const mediaType = MEDIA_TYPES.find((t) => t === echo.type);
        if (mediaType) {
          const mediaObj = echo[mediaType];
          if (mediaObj) {
            results.push({
              phoneNumberId: phone_number_id,
              to: echo.to,
              messageId: echo.id,
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

// ─── Coexistence: import de historial previo a conectar ────────────────

const historySchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string().optional(),
          value: z.object({
            metadata: z.object({
              phone_number_id: z.string(),
              display_phone_number: z.string().optional(),
            }),
            history: z
              .array(
                z.object({
                  metadata: z
                    .object({
                      phase: z.string().optional(),
                      chunk_order: z.union([z.string(), z.number()]).optional(),
                      progress: z.union([z.string(), z.number()]).optional(),
                    })
                    .optional(),
                  threads: z.array(
                    z.object({
                      id: z.string(), // número del cliente
                      messages: z.array(
                        z.object({
                          from: z.string(),
                          to: z.string().optional(),
                          id: z.string(),
                          timestamp: z.string(),
                          type: z.string(),
                          text: z.object({ body: z.string() }).optional(),
                        }),
                      ),
                    }),
                  ),
                }),
              )
              .optional(),
          }),
        }),
      ),
    }),
  ),
});

export interface ParsedHistoryMessage {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  customerPhone: string;
  messageId: string;
  timestamp: string;
  text: string | null;
  fromBusiness: boolean; // true = lo mandó el negocio (STAFF histórico), false = lo mandó el cliente
}

export interface ParsedHistoryBatch {
  messages: ParsedHistoryMessage[];
  isComplete: boolean; // metadata.phase === "complete" (Meta manda el historial en chunks)
}

export function parseHistoryPayload(payload: unknown): ParsedHistoryBatch {
  const parsed = historySchema.safeParse(payload);
  if (!parsed.success) return { messages: [], isComplete: false };

  const messages: ParsedHistoryMessage[] = [];
  let isComplete = false;

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (!isFieldMatch(change.field, "history")) continue;
      const { phone_number_id, display_phone_number } = change.value.metadata;

      for (const chunk of change.value.history ?? []) {
        if (chunk.metadata?.phase === "complete") isComplete = true;

        for (const thread of chunk.threads) {
          for (const message of thread.messages) {
            if (message.type !== "text" || !message.text?.body) continue;
            messages.push({
              phoneNumberId: phone_number_id,
              displayPhoneNumber: display_phone_number ?? null,
              customerPhone: thread.id,
              messageId: message.id,
              timestamp: message.timestamp,
              text: message.text.body,
              fromBusiness: display_phone_number ? message.from === display_phone_number : false,
            });
          }
        }
      }
    }
  }

  return { messages, isComplete };
}

// ─── Coexistence: sincronización de contactos del negocio ───────────────

const contactSyncSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string().optional(),
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }),
            state_sync: z
              .array(
                z.object({
                  type: z.string(),
                  action: z.string().optional(),
                  contact: z
                    .object({
                      full_name: z.string().optional(),
                      first_name: z.string().optional(),
                      phone_number: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
          }),
        }),
      ),
    }),
  ),
});

export interface ParsedContactSync {
  phoneNumberId: string;
  contactPhone: string;
  name: string | null;
}

export function parseContactSync(payload: unknown): ParsedContactSync[] {
  const parsed = contactSyncSchema.safeParse(payload);
  if (!parsed.success) return [];

  const results: ParsedContactSync[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (!isFieldMatch(change.field, "smb_app_state_sync")) continue;
      const { phone_number_id } = change.value.metadata;
      for (const item of change.value.state_sync ?? []) {
        if (item.type !== "contact" || !item.contact?.phone_number) continue;
        results.push({
          phoneNumberId: phone_number_id,
          contactPhone: item.contact.phone_number,
          name: item.contact.full_name ?? item.contact.first_name ?? null,
        });
      }
    }
  }
  return results;
}

// ─── Envío de mensajes ──────────────────────────────────────────

interface SendMessageResponse {
  messages?: { id: string }[];
}

export async function sendTextMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body: string;
}): Promise<{ messageId: string | null }> {
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

  const data = (await res.json()) as SendMessageResponse;
  return { messageId: data.messages?.[0]?.id ?? null };
}

// ─── Media: descarga de lo entrante, subida/envío de lo saliente ──

// Sin timeout, un fetch colgado (red del servidor, CDN de Meta lento, etc.)
// se queda esperando para siempre — el mensaje nunca se guarda ni se loguea
// el error, y Meta reintenta el mismo webhook una y otra vez sin que avancemos.
const MEDIA_FETCH_TIMEOUT_MS = 15_000;

export async function getMediaUrl(params: {
  mediaId: string;
  accessToken: string;
}): Promise<{ url: string; mimeType: string }> {
  const { mediaId, accessToken } = params;
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
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
    signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS),
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
}): Promise<{ messageId: string | null }> {
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

  const data = (await res.json()) as SendMessageResponse;
  return { messageId: data.messages?.[0]?.id ?? null };
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

// ─── Embedded Signup (Coexistence) ──────────────────────────────

// Intercambia el "code" que devuelve FB.login() (válido solo 30 segundos)
// por un access token utilizable contra la Graph API. Requiere que la app
// de Meta tenga configurado el Embedded Signup con Coexistence habilitado.
export async function exchangeEmbeddedSignupCode(params: {
  code: string;
}): Promise<{ accessToken: string }> {
  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Faltan WHATSAPP_APP_ID/WHATSAPP_APP_SECRET para el Embedded Signup.");
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", params.code);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo intercambiar el código del Embedded Signup (${res.status}): ${errorBody}`);
  }

  const data = (await res.json()) as { access_token: string };
  return { accessToken: data.access_token };
}

// Suscribe esta app a los webhooks de la WABA — sin esto, Meta no manda
// ni mensajes ni los eventos de coexistence (history, echoes, contactos).
export async function subscribeAppToWaba(params: {
  wabaId: string;
  accessToken: string;
}): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${params.wabaId}/subscribed_apps`,
    { method: "POST", headers: { Authorization: `Bearer ${params.accessToken}` } },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo suscribir la app a la WABA (${res.status}): ${errorBody}`);
  }
}
