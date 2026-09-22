import { GRAPH_API_VERSION } from "@/server/services/whatsapp";

/**
 * Resuelve el nombre real de un anuncio/campaña -- distinto de todo lo
 * demás que usa esta app: el webhook de WhatsApp (Cloud API) solo manda el
 * ID del anuncio (`referral.source_id`), nunca su nombre ni el de la
 * campaña. Para eso hace falta la Marketing API de Meta.
 *
 * No hay una variable de entorno aparte para esto: se reusa el mismo
 * access token ya guardado por conexión de WhatsApp (WhatsAppConnection),
 * ahora generado como token de Usuario del Sistema con el permiso
 * `ads_read` además de los de WhatsApp -- confirmado funcionando en
 * producción contra la cuenta act_439705266557318. Si ese token no tiene
 * `ads_read` (todavía no se actualizó, o es de una conexión vieja), Meta
 * simplemente responde con un error de permisos y esto devuelve null.
 */

export interface AdInfo {
  adName: string | null;
  campaignName: string | null;
  adsetName: string | null;
}

interface AdApiResponse {
  name?: string;
  campaign?: { name?: string };
  adset?: { name?: string };
}

/**
 * Rendimiento real del anuncio -- distinto de AdInfo (nombre/campaña/
 * conjunto, que viene del nodo del anuncio) esto viene del endpoint de
 * Insights de la Marketing API, con las métricas de inversión que Meta
 * pide ver en uso real para aprobar el permiso `ads_read` en revisión.
 */
export interface AdInsights {
  campaignName: string | null;
  adsetName: string | null;
  adName: string | null;
  spend: string | null;
  impressions: string | null;
  reach: string | null;
  clicks: string | null;
  ctr: string | null;
  cpc: string | null;
  cpm: string | null;
}

interface AdInsightsApiResponse {
  data?: Array<{
    campaign_name?: string;
    adset_name?: string;
    ad_name?: string;
    spend?: string;
    impressions?: string;
    reach?: string;
    clicks?: string;
    ctr?: string;
    cpc?: string;
    cpm?: string;
  }>;
}

/**
 * Best-effort: si `META_ADS_ACCESS_TOKEN` no está configurado, o Meta
 * responde con error (el anuncio se borró, el token no tiene acceso a esa
 * cuenta, etc.), devuelve null en vez de tirar -- lo que ya se guardó del
 * webhook (headline/body/imagen) sigue siendo válido igual.
 */
export async function resolveAdInfo(adId: string, accessToken: string): Promise<AdInfo | null> {
  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${adId}`);
    url.searchParams.set("fields", "name,campaign{name},adset{name}");
    url.searchParams.set("access_token", accessToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[meta-ads] No se pudo resolver el anuncio ${adId}: ${res.status} ${await res.text()}`);
      return null;
    }

    const data = (await res.json()) as AdApiResponse;
    return {
      adName: data.name ?? null,
      campaignName: data.campaign?.name ?? null,
      adsetName: data.adset?.name ?? null,
    };
  } catch (error) {
    console.warn(`[meta-ads] Error resolviendo el anuncio ${adId}:`, error);
    return null;
  }
}

/**
 * Rendimiento acumulado del anuncio (inversión, impresiones, alcance,
 * clics, CTR, CPC, CPM) contra el endpoint de Insights de la Marketing
 * API -- a diferencia de resolveAdInfo (que solo trae nombres), esto
 * requiere `ads_read` de verdad, no alcanza con el acceso de lectura
 * básico del nodo del anuncio.
 *
 * `date_preset=maximum` trae todo el historial disponible del anuncio en
 * una sola llamada -- alcanza para lo que necesita el panel (ver
 * rendimiento total de un anuncio puntual), no hace falta desglosar por
 * día acá.
 */
export async function resolveAdInsights(adId: string, accessToken: string): Promise<AdInsights | null> {
  try {
    const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${adId}/insights`);
    url.searchParams.set(
      "fields",
      "campaign_name,adset_name,ad_name,spend,impressions,reach,clicks,ctr,cpc,cpm",
    );
    url.searchParams.set("date_preset", "maximum");
    url.searchParams.set("access_token", accessToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[meta-ads] No se pudo traer el rendimiento del anuncio ${adId}: ${res.status} ${await res.text()}`);
      return null;
    }

    const data = (await res.json()) as AdInsightsApiResponse;
    const row = data.data?.[0];
    if (!row) return null; // el anuncio existe pero todavía no tiene actividad registrada

    return {
      campaignName: row.campaign_name ?? null,
      adsetName: row.adset_name ?? null,
      adName: row.ad_name ?? null,
      spend: row.spend ?? null,
      impressions: row.impressions ?? null,
      reach: row.reach ?? null,
      clicks: row.clicks ?? null,
      ctr: row.ctr ?? null,
      cpc: row.cpc ?? null,
      cpm: row.cpm ?? null,
    };
  } catch (error) {
    console.warn(`[meta-ads] Error trayendo el rendimiento del anuncio ${adId}:`, error);
    return null;
  }
}
