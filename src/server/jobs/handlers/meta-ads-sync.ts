import { z } from "zod";
import { decrypt } from "@/lib/crypto";
import { prisma } from "@/server/db/client";
import { syncAdAccountSpend } from "@/server/services/meta-ads";

export const metaAdsSyncPayload = z.object({
  organizationId: z.string(),
});

/**
 * Encolado desde syncMetaAdsIfDue() (api/cron/tick) para cada organización
 * con metaAdAccountId configurado. Reusa el mismo access token que ya
 * funciona para la Marketing API (el de la primera conexión de WhatsApp de
 * la organización con ads_read, ver meta-ads.ts) -- no hay un token
 * separado por organización.
 */
export async function handleMetaAdsSync(rawPayload: unknown): Promise<void> {
  const { organizationId } = metaAdsSyncPayload.parse(rawPayload);

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { metaAdAccountId: true },
  });
  if (!org?.metaAdAccountId) return; // se desconfiguró entre que se encoló y que corrió

  const connection = await prisma.whatsAppConnection.findFirst({
    where: { bot: { organizationId }, accessToken: { not: "" } },
    select: { accessToken: true },
  });
  if (!connection) {
    throw new Error(`La organización ${organizationId} no tiene ninguna conexión de WhatsApp con token para sincronizar Meta Ads`);
  }

  await syncAdAccountSpend(organizationId, org.metaAdAccountId, decrypt(connection.accessToken));

  await prisma.organization.update({
    where: { id: organizationId },
    data: { metaAdsLastSyncedAt: new Date() },
  });
}
