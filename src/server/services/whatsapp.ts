import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Meta jubila versiones ~2 años después de su salida (v19/v20 ya
// expiraron a mediados de 2026) — hay que subir esto de vez en cuando.
const GRAPH_API_VERSION = "v23.0";

// ─── Verificación de firma (Meta firma el body crudo con el App Secret) ────

// `appSecret` lo resuelve el caller (getPlatformSettings(), con fallback a
// WHATSAPP_APP_SECRET) — esta función no toca process.env directamente para
// poder configurarse desde /admin/settings sin redesplegar.
export function isValidWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | null,
): boolean {
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
            // Meta manda el nombre del perfil de WhatsApp junto con cada
            // mensaje entrante — es la fuente más confiable del nombre del
            // cliente (el webhook de contactos de coexistence casi nunca llega).
            contacts: z
              .array(
                z.object({
                  wa_id: z.string(),
                  profile: z.object({ name: z.string() }).optional(),
                }),
              )
              .optional(),
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
                  // Presente solo si el mensaje vino de un anuncio "Click to
                  // WhatsApp" o del botón de WhatsApp de una página de
                  // Facebook (requiere atribución activada en el WABA).
                  referral: z
                    .object({
                      source_type: z.string().optional(),
                      source_id: z.string().optional(),
                      ctwa_clid: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
            statuses: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.string(), // "sent" | "delivered" | "read" | "failed"
                  timestamp: z.string(),
                  errors: z
                    .array(
                      z.object({
                        code: z.number().optional(),
                        title: z.string().optional(),
                        error_data: z.object({ details: z.string().optional() }).optional(),
                      }),
                    )
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

export type InboundMediaType = "image" | "video" | "audio" | "document";

export interface ParsedInboundMessage {
  phoneNumberId: string;
  from: string;
  customerName: string | null;
  messageId: string;
  text: string | null;
  media: {
    type: InboundMediaType;
    mediaId: string;
    mimeType?: string;
    fileName?: string;
  } | null;
  // true si el mensaje trajo un objeto "referral" — vino de un anuncio
  // Click-to-WhatsApp o del botón de WhatsApp de una página de Facebook.
  fromAd: boolean;
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

      const namesByWaId = new Map<string, string>();
      for (const contact of change.value.contacts ?? []) {
        if (contact.profile?.name) namesByWaId.set(contact.wa_id, contact.profile.name);
      }

      for (const message of change.value.messages ?? []) {
        const customerName = namesByWaId.get(message.from) ?? null;
        const fromAd = Boolean(message.referral);

        if (message.type === "text" && message.text?.body) {
          results.push({
            phoneNumberId: phone_number_id,
            from: message.from,
            customerName,
            messageId: message.id,
            text: message.text.body,
            media: null,
            fromAd,
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
              customerName,
              messageId: message.id,
              text: mediaObj.caption ?? null,
              media: {
                type: mediaType,
                mediaId: mediaObj.id,
                mimeType: mediaObj.mime_type,
                fileName: mediaObj.filename,
              },
              fromAd,
            });
          }
        }
      }
    }
  }
  return results;
}

// Traduce los códigos de error más comunes de la Cloud API a algo que el
// vendedor entienda sin ir a buscar la documentación.
function describeMessageError(code: number | undefined, fallback: string | undefined): string {
  switch (code) {
    case 131047:
      return "Pasaron más de 24h desde que el cliente escribió — hace falta una plantilla aprobada.";
    case 131026:
      return "El cliente no tiene WhatsApp activo o bloqueó el número.";
    case 131053:
      return "Formato de imagen no soportado (por ejemplo WebP fuera de stickers).";
    case 131031:
      return "La cuenta de WhatsApp está restringida por Meta.";
    case 470:
      return "Fuera de la ventana de 24h para mensajes normales.";
    default:
      return fallback || "No se pudo entregar el mensaje.";
  }
}

export interface ParsedStatusUpdate {
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorDetail: string | null;
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
          const err = status.errors?.[0];
          results.push({
            messageId: status.id,
            status: status.status as ParsedStatusUpdate["status"],
            errorDetail: err ? describeMessageError(err.code, err.error_data?.details ?? err.title) : null,
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
  /**
   * phone_number_id del chunk "complete" — se guarda aparte de `messages`
   * porque ese último chunk (el que de verdad marca el fin de la
   * importación) puede llegar sin ningún thread/mensaje adentro, solo como
   * aviso de "ya terminé". Si `isComplete` dependiera de que `messages` no
   * esté vacío, ese caso dejaría el estado pegado en "Importando..." para
   * siempre.
   */
  completedPhoneNumberId: string | null;
}

export function parseHistoryPayload(payload: unknown): ParsedHistoryBatch {
  const parsed = historySchema.safeParse(payload);
  if (!parsed.success) return { messages: [], isComplete: false, completedPhoneNumberId: null };

  const messages: ParsedHistoryMessage[] = [];
  let isComplete = false;
  let completedPhoneNumberId: string | null = null;

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (!isFieldMatch(change.field, "history")) continue;
      const { phone_number_id, display_phone_number } = change.value.metadata;

      for (const chunk of change.value.history ?? []) {
        if (chunk.metadata?.phase === "complete") {
          isComplete = true;
          completedPhoneNumberId = phone_number_id;
        }

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

  return { messages, isComplete, completedPhoneNumberId };
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
  appId: string;
  appSecret: string;
}): Promise<{ accessToken: string }> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", params.appId);
  url.searchParams.set("client_secret", params.appSecret);
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

// ─── Perfil de negocio (foto, descripción, dirección, etc.) ─────
//
// Es el perfil que ve el cliente al abrir el chat — distinto del catálogo
// interno de la app. Meta expone hasta 2 sitios web y una categoría fija
// (vertical) por WABA.

const BUSINESS_PROFILE_FIELDS =
  "about,address,description,email,profile_picture_url,websites,vertical";

export interface BusinessProfile {
  about: string;
  address: string;
  description: string;
  email: string;
  profilePictureUrl: string | null;
  websites: string[];
  vertical: string;
}

export async function getBusinessProfile(params: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<BusinessProfile> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${params.phoneNumberId}/whatsapp_business_profile?fields=${BUSINESS_PROFILE_FIELDS}`,
    { headers: { Authorization: `Bearer ${params.accessToken}` } },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo leer el perfil de negocio (${res.status}): ${errorBody}`);
  }

  const data = (await res.json()) as { data?: Record<string, unknown>[] };
  const profile = data.data?.[0] ?? {};

  return {
    about: (profile.about as string) ?? "",
    address: (profile.address as string) ?? "",
    description: (profile.description as string) ?? "",
    email: (profile.email as string) ?? "",
    profilePictureUrl: (profile.profile_picture_url as string) ?? null,
    websites: (profile.websites as string[]) ?? [],
    vertical: (profile.vertical as string) ?? "UNDEFINED",
  };
}

export async function updateBusinessProfile(params: {
  phoneNumberId: string;
  accessToken: string;
  data: Partial<{
    about: string;
    address: string;
    description: string;
    email: string;
    websites: string[];
    vertical: string;
    profilePictureHandle: string;
  }>;
}): Promise<void> {
  const body: Record<string, unknown> = { messaging_product: "whatsapp" };
  if (params.data.about !== undefined) body.about = params.data.about;
  if (params.data.address !== undefined) body.address = params.data.address;
  if (params.data.description !== undefined) body.description = params.data.description;
  if (params.data.email !== undefined) body.email = params.data.email;
  if (params.data.websites !== undefined) body.websites = params.data.websites;
  if (params.data.vertical !== undefined) body.vertical = params.data.vertical;
  if (params.data.profilePictureHandle !== undefined) {
    body.profile_picture_handle = params.data.profilePictureHandle;
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${params.phoneNumberId}/whatsapp_business_profile`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo actualizar el perfil de negocio (${res.status}): ${errorBody}`);
  }
}

// La foto de perfil no se sube por /media (eso es para adjuntos de
// mensajes): usa la Resumable Upload API de Meta, en dos pasos — abrir una
// sesión de subida contra la App (no el número) y mandar el archivo a esa
// sesión para obtener el handle que luego se manda en profile_picture_handle.
export async function uploadBusinessProfilePhoto(params: {
  appId: string;
  accessToken: string;
  file: Buffer;
  mimeType: string;
}): Promise<string> {
  const startUrl = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${params.appId}/uploads`);
  startUrl.searchParams.set("file_length", String(params.file.length));
  startUrl.searchParams.set("file_type", params.mimeType);
  startUrl.searchParams.set("access_token", params.accessToken);

  const startRes = await fetch(startUrl.toString(), { method: "POST" });
  if (!startRes.ok) {
    const errorBody = await startRes.text();
    throw new Error(`No se pudo iniciar la subida de la foto (${startRes.status}): ${errorBody}`);
  }
  const { id: uploadSessionId } = (await startRes.json()) as { id: string };

  const uploadRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${uploadSessionId}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${params.accessToken}`,
      file_offset: "0",
    },
    body: new Uint8Array(params.file),
  });
  if (!uploadRes.ok) {
    const errorBody = await uploadRes.text();
    throw new Error(`No se pudo subir la foto (${uploadRes.status}): ${errorBody}`);
  }
  const { h } = (await uploadRes.json()) as { h: string };
  return h;
}

// ─── Plantillas de mensaje (para responder fuera de la ventana de 24h) ────
//
// WhatsApp solo deja mandar texto libre dentro de las 24h desde el último
// mensaje del cliente (error 131047 "Re-engagement message" si no). Pasado
// ese plazo, la única forma de escribirle primero es con una plantilla ya
// aprobada por Meta — de ahí estas funciones: crear una plantilla nueva
// (queda "PENDING" hasta que Meta la revisa, normalmente en minutos u
// horas), listar las que ya están aprobadas, y mandarlas.

export interface MessageTemplateComponent {
  type: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string; // TEXT | IMAGE | VIDEO | DOCUMENT (solo en HEADER)
  text?: string;
  buttons?: { type: string; text: string }[];
}

export interface MessageTemplate {
  id: string;
  name: string;
  status: string; // APPROVED | PENDING | REJECTED | ...
  category: string;
  language: string;
  components: MessageTemplateComponent[];
  rejected_reason?: string; // NONE | ABUSIVE_CONTENT | INVALID_FORMAT | TAG_CONTENT_MISMATCH | ...
}

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export async function createMessageTemplate(params: {
  wabaId: string;
  accessToken: string;
  name: string; // solo minúsculas, números y guion bajo — lo exige Meta
  category: TemplateCategory;
  languageCode: string; // código BCP-47, ej. "es", "es_MX", "en_US"
  bodyText: string; // puede llevar variables {{1}}, {{2}}...
  bodyExample?: string[]; // valores de ejemplo para cada {{n}} — obligatorio si hay variables, si no Meta rechaza automáticamente
}): Promise<{ id: string; status: string; category: string }> {
  const bodyComponent: Record<string, unknown> = { type: "BODY", text: params.bodyText };
  if (params.bodyExample && params.bodyExample.length > 0) {
    bodyComponent.example = { body_text: [params.bodyExample] };
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${params.wabaId}/message_templates`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: params.name,
        category: params.category,
        language: params.languageCode,
        components: [bodyComponent],
      }),
    },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo crear la plantilla (${res.status}): ${errorBody}`);
  }

  return (await res.json()) as { id: string; status: string; category: string };
}

export async function deleteMessageTemplate(params: {
  wabaId: string;
  accessToken: string;
  name: string;
}): Promise<void> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${params.wabaId}/message_templates`);
  url.searchParams.set("name", params.name);

  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo borrar la plantilla (${res.status}): ${errorBody}`);
  }
}

export async function listMessageTemplates(params: {
  wabaId: string;
  accessToken: string;
}): Promise<MessageTemplate[]> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${params.wabaId}/message_templates`);
  url.searchParams.set("fields", "name,status,category,language,components,rejected_reason");
  url.searchParams.set("limit", "100");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudieron leer las plantillas (${res.status}): ${errorBody}`);
  }
  const data = (await res.json()) as { data: MessageTemplate[] };
  return data.data;
}

export async function sendTemplateMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  languageCode: string;
  // Solo variables {{1}}, {{2}}... del componente BODY — es lo único que
  // este panel deja rellenar; encabezado/botones se mandan tal cual están
  // en la plantilla aprobada.
  bodyParams: string[];
}): Promise<{ messageId: string | null }> {
  const { phoneNumberId, accessToken, to, templateName, languageCode, bodyParams } = params;

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
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components: bodyParams.length
            ? [
                {
                  type: "body",
                  parameters: bodyParams.map((text) => ({ type: "text", text })),
                },
              ]
            : undefined,
        },
      }),
    },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo enviar la plantilla (${res.status}): ${errorBody}`);
  }

  const data = (await res.json()) as SendMessageResponse;
  return { messageId: data.messages?.[0]?.id ?? null };
}
