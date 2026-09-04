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
