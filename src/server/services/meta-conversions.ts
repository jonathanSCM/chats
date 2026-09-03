import { prisma } from "@/server/db/client";
import { decrypt } from "@/lib/crypto";
import { GRAPH_API_VERSION } from "@/server/services/whatsapp";

/**
 * Le avisa a Meta qué pasó DESPUÉS de que un lead escribió por un anuncio
 * "Click to WhatsApp" -- sin esto, Meta solo sabe que alguien mandó un
 * mensaje, nunca si esa conversación terminó en una venta real. Con esto,
 * el algoritmo de entrega de los anuncios puede optimizar hacia gente que
 * de verdad compra, no solo hacia gente que escribe.
 *
 * Requiere el permiso `whatsapp_business_manage_events` en el token de la
 * conexión -- distinto de los que ya se piden hoy (`whatsapp_business_management`
 * para Embedded Signup). Si Meta no lo dio, estas llamadas van a fallar con
 * un error de permisos hasta que se pida en la app de Meta.
 */

interface DatasetResponse {
  dataset_id?: string;
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
  if (!data.dataset_id) throw new Error("Meta no devolvió un dataset_id.");
  return data.dataset_id;
}

/**
 * Manda un evento de conversión atado al clic del anuncio original
 * (`ctwa_clid`, capturado del webhook cuando llegó el primer mensaje —
 * ver whatsapp.ts). `eventName` usa el vocabulario que Meta espera para
 * estos eventos (ej. "Purchase", "QualifiedLead"), no uno inventado.
 */
export async function sendConversionEvent(params: {
  datasetId: string;
  accessToken: string;
  eventName: "Purchase" | "QualifiedLead";
  ctwaClid: string;
  eventTime?: Date;
  value?: number;
  currency?: string;
}): Promise<void> {
  const { datasetId, accessToken, eventName, ctwaClid, eventTime, value, currency } = params;

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${datasetId}/events?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            event_name: eventName,
            event_time: Math.floor((eventTime ?? new Date()).getTime() / 1000),
            action_source: "business_messaging",
            messaging_channel: "whatsapp",
            user_data: { ctwa_clid: ctwaClid },
            ...(value !== undefined ? { custom_data: { currency: currency ?? "USD", value } } : {}),
          },
        ],
      }),
    },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`No se pudo mandar el evento de conversión a Meta (${res.status}): ${errorBody}`);
  }
}

/**
 * Se llama cuando una oportunidad pasa a "Ganado". Best-effort: si el lead
 * no vino de un anuncio "Click to WhatsApp" (no hay ctwa_clid guardado, ej.
 * llegó orgánico o por Coexistence), no hace nada -- no es un error, es el
 * caso normal para la mayoría de los clientes.
 *
 * `metaConversionSentAt` se marca ANTES de mandar el evento, no después:
 * Meta no deduplica estos eventos de su lado, así que ante una falla de red
 * a mitad de camino es más seguro arriesgarse a no reintentar un envío que
 * quizás sí llegó, que arriesgarse a contar la misma venta dos veces.
 */
export async function reportOpportunityWon(opportunityId: string): Promise<void> {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: {
      metaConversionSentAt: true,
      estimatedValue: true,
      currency: true,
      organizationId: true,
      contact: { select: { phone: true } },
    },
  });
  if (!opportunity || opportunity.metaConversionSentAt) return;

  // Se busca la conversación que originó el contacto (la primera marcada
  // como venida de un anuncio) -- es la que tiene el ctwa_clid del clic
  // real que generó este lead.
  const conversation = await prisma.conversation.findFirst({
    where: {
      customerPhone: opportunity.contact.phone,
      adReferral: true,
      bot: { organizationId: opportunity.organizationId },
    },
    orderBy: { startedAt: "asc" },
    select: { adReferralData: true, botId: true },
  });
  const ctwaClid = (conversation?.adReferralData as { ctwaClid?: string | null } | null)?.ctwaClid;
  if (!conversation || !ctwaClid) return;

  const connection = await prisma.whatsAppConnection.findUnique({
    where: { botId: conversation.botId },
    select: { wabaId: true, accessToken: true, metaDatasetId: true },
  });
  if (!connection?.wabaId) return;

  // Compare-and-swap: si dos disparos concurrentes llegaran a la vez (poco
  // probable, pero el mismo cuidado que ya se usa en otros lados de la
  // app), solo el primero pasa este `updateMany` con éxito.
  const claimed = await prisma.opportunity.updateMany({
    where: { id: opportunityId, metaConversionSentAt: null },
    data: { metaConversionSentAt: new Date() },
  });
  if (claimed.count === 0) return;

  try {
    const accessToken = decrypt(connection.accessToken);
    let datasetId = connection.metaDatasetId;
    if (!datasetId) {
      datasetId = await getOrCreateDataset({ wabaId: connection.wabaId, accessToken });
      await prisma.whatsAppConnection.update({
        where: { botId: conversation.botId },
        data: { metaDatasetId: datasetId },
      });
    }

    await sendConversionEvent({
      datasetId,
      accessToken,
      eventName: "Purchase",
      ctwaClid,
      value: opportunity.estimatedValue ? Number(opportunity.estimatedValue) : undefined,
      currency: opportunity.currency,
    });
  } catch (error) {
    // No se revierte metaConversionSentAt -- ver nota arriba de la función.
    console.error(`[meta-conversions] No se pudo reportar la venta de la oportunidad ${opportunityId} a Meta:`, error);
  }
}
