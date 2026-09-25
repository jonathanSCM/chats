import { prisma } from "@/server/db/client";
import { decrypt } from "@/lib/crypto";
import { GRAPH_API_VERSION } from "@/server/services/whatsapp";

/**
 * Le avisa a Meta qué pasó DESPUÉS de que un lead escribió por un anuncio
 * "Click to WhatsApp" -- sin esto, Meta solo sabe que alguien mandó un
 * mensaje, nunca si esa conversación terminó en un lead calificado o una
 * venta real. Con esto, el algoritmo de entrega de los anuncios puede
 * optimizar hacia gente que de verdad compra, no solo hacia gente que
 * escribe.
 *
 * Requiere el permiso `whatsapp_business_manage_events` en el token de la
 * conexión -- distinto de los que ya se piden hoy (`whatsapp_business_management`
 * para Embedded Signup). Si Meta no lo dio, estas llamadas van a fallar con
 * un error de permisos hasta que se pida en la app de Meta.
 */

interface DatasetResponse {
  id?: string;
}

/**
 * Pide (o crea, la primera vez) el dataset de Conversions API de esta WABA.
 * Idempotente del lado de Meta: pedirlo de nuevo devuelve el mismo id, así
 * que no hace falta guardar el resultado -- igual se cachea en
 * WhatsAppConnection.metaDatasetId para no pegarle a esta llamada en cada
 * conversión.
 */
export async function getOrCreateDataset(params: {
  wabaId: string;
  accessToken: string;
}): Promise<string> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${params.wabaId}/dataset`,
    { method: "POST", headers: { Authorization: `Bearer ${params.accessToken}` } },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo obtener el dataset de Conversions API (${res.status}): ${errorBody}`);
  }

  const data = (await res.json()) as DatasetResponse;
  if (!data.id) throw new Error("Meta no devolvió un id de dataset.");
  return data.id;
}

/**
 * Manda un evento de conversión atado al clic del anuncio original
 * (`ctwa_clid`, capturado del webhook cuando llegó el primer mensaje —
 * ver whatsapp.ts). `eventName` usa el vocabulario que Meta espera para
 * estos eventos (ej. "Purchase", "QualifiedLead"), no uno inventado.
 *
 * `eventId` es obligatorio y determinístico (ver reportOpportunityQualified/
 * reportOpportunityWon) -- es lo que le permite a Meta deduplicar del lado
 * de ellos si el job de la cola reintenta un envío que en realidad ya había
 * llegado.
 */
export async function sendConversionEvent(params: {
  datasetId: string;
  accessToken: string;
  eventName: "Purchase" | "QualifiedLead";
  eventId: string;
  ctwaClid: string;
  /** Meta lo exige para eventos business_messaging/whatsapp -- confirmado
   * probando contra Test Events: sin esto, Meta rechaza el evento entero
   * con "Falta el identificador de la cuenta de WhatsApp Business". */
  wabaId: string;
  eventTime?: Date;
  value?: number;
  currency?: string;
  /** Solo se manda cuando META_CONVERSIONS_TEST_EVENT_CODE está seteado --
   * hace que el evento aparezca en el panel de Test Events de Meta en vez
   * de contar como tráfico real, para poder probar sin ensuciar datos. */
  testEventCode?: string;
}): Promise<void> {
  const { datasetId, accessToken, eventName, eventId, ctwaClid, wabaId, eventTime, value, currency, testEventCode } =
    params;

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${datasetId}/events?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            event_name: eventName,
            event_id: eventId,
            event_time: Math.floor((eventTime ?? new Date()).getTime() / 1000),
            action_source: "business_messaging",
            messaging_channel: "whatsapp",
            user_data: { ctwa_clid: ctwaClid, whatsapp_business_account_id: wabaId },
            ...(value !== undefined ? { custom_data: { currency: currency ?? "USD", value } } : {}),
          },
        ],
        ...(testEventCode ? { test_event_code: testEventCode } : {}),
      }),
    },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo mandar el evento de conversión a Meta (${res.status}): ${errorBody}`);
  }
}

/** META_CONVERSIONS_TEST_EVENT_CODE vacío/sin setear en producción -- ver .env.example. */
function testEventCode(): string | undefined {
  return process.env.META_CONVERSIONS_TEST_EVENT_CODE || undefined;
}

interface ResolvedAttribution {
  ctwaClid: string;
  botId: string;
  connection: { wabaId: string; accessToken: string; metaDatasetId: string | null };
}

/**
 * Encuentra el ctwa_clid y la conexión de WhatsApp para reportar un evento
 * de esta oportunidad a Meta. Primero busca la atribución YA LIGADA a la
 * oportunidad (el touch de la conversación puntual que la originó, ver
 * linkAttributionToOpportunity en meta-attribution.ts). Si no hay
 * (oportunidades creadas antes de que existiera ese vínculo, o creadas
 * fuera del flujo del bot), cae al método viejo: la primera conversación
 * del contacto marcada como venida de un anuncio. Devuelve null si el lead
 * no vino de un anuncio "Click to WhatsApp" -- caso normal, no un error.
 */
async function resolveAttributionAndConnection(params: {
  opportunityId: string;
  organizationId: string;
  contactPhone: string;
}): Promise<ResolvedAttribution | null> {
  const touch = await prisma.metaAttributionTouch.findFirst({
    where: { opportunityId: params.opportunityId },
    orderBy: { capturedAt: "asc" },
    select: { ctwaClid: true, conversationId: true },
  });

  let ctwaClid = touch?.ctwaClid ?? null;
  let botId = touch?.conversationId
    ? (await prisma.conversation.findUnique({ where: { id: touch.conversationId }, select: { botId: true } }))?.botId
    : undefined;

  if (!ctwaClid || !botId) {
    const conversation = await prisma.conversation.findFirst({
      where: {
        customerPhone: params.contactPhone,
        adReferral: true,
        bot: { organizationId: params.organizationId },
      },
      orderBy: { startedAt: "asc" },
      select: { adReferralData: true, botId: true },
    });
    ctwaClid = (conversation?.adReferralData as { ctwaClid?: string | null } | null)?.ctwaClid ?? null;
    botId = conversation?.botId;
  }
  if (!ctwaClid || !botId) return null;

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { botId },
    select: { wabaId: true, accessToken: true, metaDatasetId: true },
  });
  if (!connection?.wabaId) return null;

  return { ctwaClid, botId, connection: { ...connection, wabaId: connection.wabaId } };
}

/** Dataset cacheado en la conexión, o lo crea la primera vez -- compartido por los dos eventos. */
async function ensureDataset(
  botId: string,
  connection: { wabaId: string; accessToken: string; metaDatasetId: string | null },
): Promise<{ datasetId: string; accessToken: string }> {
  const accessToken = decrypt(connection.accessToken);
  let datasetId = connection.metaDatasetId;
  if (!datasetId) {
    datasetId = await getOrCreateDataset({ wabaId: connection.wabaId, accessToken });
    await prisma.whatsAppConnection.update({ where: { botId }, data: { metaDatasetId: datasetId } });
  }
  return { datasetId, accessToken };
}

/**
 * Se llama la primera vez que una oportunidad deja la etapa de entrada por
 * defecto (manual §Meta Ads Regla 2 — "POR CALIFICAR → ENTREVISTA", ahora
 * generalizado porque el pipeline es configurable por organización, ver
 * crm.ts). A diferencia de reportOpportunityWon (legacy, marca ANTES de
 * mandar y nunca reintenta), esta función SÍ puede reintentarse con
 * seguridad porque la llama un job de la cola (con backoff) y el evento
 * lleva un event_id determinístico -- Meta deduplica de su lado si un
 * reintento en realidad ya había llegado. Por eso acá se marca DESPUÉS de
 * un envío confirmado, no antes, y un error se relanza (throw) para que el
 * job falle y la cola lo reintente en vez de tragárselo en silencio.
 */
export async function reportOpportunityQualified(opportunityId: string): Promise<void> {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: { qualifiedEventSentAt: true, organizationId: true, contact: { select: { phone: true } } },
  });
  if (!opportunity || opportunity.qualifiedEventSentAt) return;

  const resolved = await resolveAttributionAndConnection({
    opportunityId,
    organizationId: opportunity.organizationId,
    contactPhone: opportunity.contact.phone,
  });
  if (!resolved) return;

  const eventId = `opportunity_${opportunityId}_qualified_v1`;
  const { datasetId, accessToken } = await ensureDataset(resolved.botId, resolved.connection);

  await sendConversionEvent({
    datasetId,
    accessToken,
    eventName: "QualifiedLead",
    eventId,
    ctwaClid: resolved.ctwaClid,
    wabaId: resolved.connection.wabaId,
    testEventCode: testEventCode(),
  });

  await prisma.opportunity.updateMany({
    where: { id: opportunityId, qualifiedEventSentAt: null },
    data: { qualifiedEventSentAt: new Date(), qualifiedEventId: eventId },
  });
}

/**
 * Se llama cuando una oportunidad pasa a "Ganado". Best-effort: si el lead
 * no vino de un anuncio "Click to WhatsApp", o todavía no tiene valor/moneda
 * confirmados, no manda nada -- no es un error, son los casos normales para
 * la mayoría de las oportunidades.
 *
 * Usa purchaseEventSentAt/purchaseEventId (no metaConversionSentAt, el
 * campo legacy que ya tiene datos reales en producción de antes de que
 * existiera esta versión -- se sigue chequeando también, nunca se vuelve a
 * escribir). Mismo cuidado que reportOpportunityQualified: se marca
 * DESPUÉS de un envío confirmado y un error se relanza para que la cola
 * reintente -- el event_id determinístico hace que un reintento sea
 * seguro del lado de Meta.
 */
export async function reportOpportunityWon(opportunityId: string): Promise<void> {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: {
      metaConversionSentAt: true,
      purchaseEventSentAt: true,
      estimatedValue: true,
      currency: true,
      organizationId: true,
      contact: { select: { phone: true } },
    },
  });
  if (!opportunity || opportunity.metaConversionSentAt || opportunity.purchaseEventSentAt) return;
  if (!opportunity.estimatedValue || !opportunity.currency) return;

  const resolved = await resolveAttributionAndConnection({
    opportunityId,
    organizationId: opportunity.organizationId,
    contactPhone: opportunity.contact.phone,
  });
  if (!resolved) return;

  const eventId = `opportunity_${opportunityId}_purchase_v1`;
  const { datasetId, accessToken } = await ensureDataset(resolved.botId, resolved.connection);

  await sendConversionEvent({
    datasetId,
    accessToken,
    eventName: "Purchase",
    eventId,
    ctwaClid: resolved.ctwaClid,
    wabaId: resolved.connection.wabaId,
    value: Number(opportunity.estimatedValue),
    currency: opportunity.currency,
    testEventCode: testEventCode(),
  });

  await prisma.opportunity.updateMany({
    where: { id: opportunityId, purchaseEventSentAt: null },
    data: { purchaseEventSentAt: new Date(), purchaseEventId: eventId },
  });
}
