import { GRAPH_API_VERSION } from "@/server/services/whatsapp";
import { prisma } from "@/server/db/client";

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
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adAccountId: string | null;
}

interface AdApiResponse {
  name?: string;
  account_id?: string;
  campaign?: { id?: string; name?: string };
  adset?: { id?: string; name?: string };
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
    url.searchParams.set("fields", "name,account_id,campaign{id,name},adset{id,name}");
    url.searchParams.set("access_token", accessToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[meta-ads] No se pudo resolver el anuncio ${adId}: ${res.status} ${await res.text()}`);
      return null;
    }

    const data = (await res.json()) as AdApiResponse;
    return {
      adName: data.name ?? null,
      campaignId: data.campaign?.id ?? null,
      campaignName: data.campaign?.name ?? null,
      adsetId: data.adset?.id ?? null,
      adsetName: data.adset?.name ?? null,
      adAccountId: data.account_id ?? null,
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

interface AdAccountInsightsRow {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
}

interface AdAccountInsightsApiResponse {
  data?: AdAccountInsightsRow[];
  paging?: { next?: string };
}

/**
 * Sincroniza el gasto/impresiones/alcance de TODA la cuenta publicitaria de
 * una organización en un solo llamado paginado (level=ad, time_increment=1)
 * -- a diferencia de resolveAdInsights (un anuncio a la vez, on-demand),
 * esto trae todos los anuncios con actividad en los últimos 7 días de una,
 * porque Meta ya incluye el nombre de campaña/conjunto/anuncio en cada fila
 * del insights, sin hace falta pedirlos aparte.
 *
 * `date_preset=last_7d` (no "yesterday" ni "today"): los últimos días de un
 * período pueden seguir cambiando mientras Meta termina de consolidar, y
 * repetir la ventana en cada sync hace que un día que falló se recupere
 * solo en el siguiente. El upsert sobre @@unique([organizationId, adId,
 * date]) hace que reintentar nunca duplique.
 */
export async function syncAdAccountSpend(
  organizationId: string,
  adAccountId: string,
  accessToken: string,
  datePreset?: string,
): Promise<number> {
  let rowCount = 0;
  // La primera vez trae 90 días de historia (una campaña puede haber empezado
  // hace semanas); después alcanza con 7 (ver arriba). `datePreset` fuerza otra ventana.
  const hasHistory = (await prisma.adSpendSnapshot.count({ where: { organizationId } })) > 0;
  let url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${adAccountId}/insights`);
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("date_preset", datePreset ?? (hasHistory ? "last_7d" : "last_90d"));
  url.searchParams.set(
    "fields",
    "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,ctr,cpc,cpm,frequency",
  );
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("limit", "500");

  while (true) {
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(
        `No se pudo sincronizar el gasto de ${adAccountId}: ${res.status} ${await res.text()}`,
      );
    }

    const data = (await res.json()) as AdAccountInsightsApiResponse;
    for (const row of data.data ?? []) {
      if (!row.ad_id || !row.date_start) continue; // fila sin identificar, no debería pasar pero no vale la pena tumbar todo el sync por una

      await prisma.adSpendSnapshot.upsert({
        where: {
          organizationId_adId_date: {
            organizationId,
            adId: row.ad_id,
            date: new Date(row.date_start),
          },
        },
        create: {
          organizationId,
          date: new Date(row.date_start),
          campaignId: row.campaign_id ?? "",
          campaignName: row.campaign_name ?? "",
          adsetId: row.adset_id ?? "",
          adsetName: row.adset_name ?? "",
          adId: row.ad_id,
          adName: row.ad_name ?? "",
          spend: row.spend ?? "0",
          impressions: Number(row.impressions ?? 0),
          reach: Number(row.reach ?? 0),
          clicks: Number(row.clicks ?? 0),
          ctr: row.ctr ?? null,
          cpc: row.cpc ?? null,
          cpm: row.cpm ?? null,
          frequency: row.frequency ?? null,
        },
        update: {
          campaignId: row.campaign_id ?? "",
          campaignName: row.campaign_name ?? "",
          adsetId: row.adset_id ?? "",
          adsetName: row.adset_name ?? "",
          adName: row.ad_name ?? "",
          spend: row.spend ?? "0",
          impressions: Number(row.impressions ?? 0),
          reach: Number(row.reach ?? 0),
          clicks: Number(row.clicks ?? 0),
          ctr: row.ctr ?? null,
          cpc: row.cpc ?? null,
          cpm: row.cpm ?? null,
          frequency: row.frequency ?? null,
          syncedAt: new Date(),
        },
      });
      rowCount++;
    }

    if (!data.paging?.next) break;
    url = new URL(data.paging.next);
  }

  return rowCount;
}

export interface AdAccountSummary {
  id: string; // act_XXXXXXXXX
  name: string;
}

/**
 * Cuentas publicitarias que la persona autorizó en el login. Con un token de
 * usuario del sistema, /me es el usuario del sistema (no la persona) y no
 * lista nada: el camino documentado es debug_token, que devuelve en
 * granular_scopes los IDs de las cuentas autorizadas para ads_read. Si eso
 * no trae nada, se prueba /me/adaccounts (tokens de usuario normales).
 */
export async function listAdAccounts(
  accessToken: string,
  app: { appId: string; appSecret: string },
): Promise<AdAccountSummary[]> {
  const debugUrl = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/debug_token`);
  debugUrl.searchParams.set("input_token", accessToken);
  debugUrl.searchParams.set("access_token", `${app.appId}|${app.appSecret}`);
  const debugRes = await fetch(debugUrl.toString());
  if (!debugRes.ok) {
    throw new Error(`No se pudo inspeccionar el token de Meta Ads (${debugRes.status}): ${await debugRes.text()}`);
  }
  const debug = (await debugRes.json()) as {
    data?: { granular_scopes?: Array<{ scope: string; target_ids?: string[] }> };
  };
  const ids = (debug.data?.granular_scopes ?? [])
    .filter((g) => g.scope === "ads_read" || g.scope === "ads_management")
    .flatMap((g) => g.target_ids ?? []);

  if (ids.length > 0) {
    const unique = [...new Set(ids.map((id) => (id.startsWith("act_") ? id : `act_${id}`)))];
    return Promise.all(
      unique.map(async (id) => {
        try {
          const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${id}?fields=name`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const data = res.ok ? ((await res.json()) as { name?: string }) : {};
          return { id, name: data.name || id };
        } catch {
          return { id, name: id };
        }
      }),
    );
  }

  console.warn("[meta-ads] debug_token no trajo cuentas autorizadas:", JSON.stringify(debug.data ?? debug));

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/me/adaccounts`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("limit", "100");
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`No se pudieron listar las cuentas publicitarias (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { data?: Array<{ id: string; name?: string }> };
  return (data.data ?? []).map((a) => ({ id: a.id, name: a.name || a.id }));
}

/** Pide a Meta extender la vida del token (fb_exchange_token). Devuelve el token nuevo y su duración en segundos. */
export async function extendAccessToken(params: {
  accessToken: string;
  appId: string;
  appSecret: string;
}): Promise<{ accessToken: string; expiresIn: number | null }> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", params.appId);
  url.searchParams.set("client_secret", params.appSecret);
  url.searchParams.set("fb_exchange_token", params.accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`No se pudo extender el token de Meta Ads (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? null };
}

/** Nombre y moneda de la cuenta publicitaria (el gasto de Meta viene en esa moneda). Best-effort: null si falla. */
export async function getAdAccountInfo(
  adAccountId: string,
  accessToken: string,
): Promise<{ name: string | null; currency: string | null } | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${adAccountId}?fields=name,currency`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string; currency?: string };
    return { name: data.name ?? null, currency: data.currency ?? null };
  } catch {
    return null;
  }
}
