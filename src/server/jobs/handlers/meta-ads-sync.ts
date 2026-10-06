import { z } from "zod";
import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/server/db/client";
import { syncAdAccountSpend, extendAccessToken, getAdAccountInfo } from "@/server/services/meta-ads";
import { getPlatformSettings } from "@/server/services/platform-settings";
import { isMarketingEnabled } from "@/lib/features";

export const metaAdsSyncPayload = z.object({
  organizationId: z.string(),
});

const EXTEND_WHEN_LESS_THAN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Encolado desde syncMetaAdsIfDue() (api/cron/tick) para cada organización
 * que conectó Meta Ads. Usa el token que esa organización autorizó con
 * "Conectar con Facebook" (solo ads_read), no el de WhatsApp.
 */
export async function handleMetaAdsSync(rawPayload: unknown): Promise<void> {
  const { organizationId } = metaAdsSyncPayload.parse(rawPayload);
  if (!isMarketingEnabled()) return; // apagado: el job pendiente se descarta sin llamar a Meta

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { metaAdAccountId: true, metaAdsAccessToken: true, metaAdsTokenExpiresAt: true },
  });
  if (!org?.metaAdAccountId || !org.metaAdsAccessToken) return; // desconectada o pendiente de reconexión

  let accessToken = decrypt(org.metaAdsAccessToken);

  // Best-effort: si falla la extensión, se intenta el sync igual con el token actual.
  if (org.metaAdsTokenExpiresAt && org.metaAdsTokenExpiresAt.getTime() - Date.now() < EXTEND_WHEN_LESS_THAN_MS) {
    try {
      const settings = await getPlatformSettings();
      if (settings.whatsappAppId && settings.whatsappAppSecret) {
        const extended = await extendAccessToken({
          accessToken,
          appId: settings.whatsappAppId,
          appSecret: settings.whatsappAppSecret,
        });
        accessToken = extended.accessToken;
        await prisma.organization.update({
          where: { id: organizationId },
          data: {
            metaAdsAccessToken: encrypt(extended.accessToken),
            metaAdsTokenExpiresAt: extended.expiresIn ? new Date(Date.now() + extended.expiresIn * 1000) : null,
          },
        });
      }
    } catch (error) {
      console.warn(`[meta-ads-sync] No se pudo extender el token de ${organizationId}:`, error);
    }
  }

  const info = await getAdAccountInfo(org.metaAdAccountId, accessToken);
  if (info?.currency) {
    await prisma.organization.update({ where: { id: organizationId }, data: { metaAdCurrency: info.currency } });
  }

  try {
    await syncAdAccountSpend(organizationId, org.metaAdAccountId, accessToken);
  } catch (error) {
    // 190 = token vencido/revocado: reintentar no sirve, hay que reconectar.
    // Se borra el token (la pantalla pasa a "Reconectar") y no se reintenta.
    if (error instanceof Error && error.message.includes('"code":190')) {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { metaAdsAccessToken: null, metaAdsTokenExpiresAt: null },
      });
      return;
    }
    throw error;
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { metaAdsLastSyncedAt: new Date() },
  });
}
