import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import type { AdReferralInfo } from "@/server/services/whatsapp";
import type { AdInfo } from "@/server/services/meta-ads";

/**
 * Registra un touch de atribución (Anuncio → WhatsApp → conversación →
 * contacto) en MetaAttributionTouch -- tabla append-only, a diferencia de
 * Conversation.adReferralData (que solo guarda el touch más reciente
 * dentro de su ventana de 24h y sigue usándose tal cual para el badge
 * "Anuncio" del inbox). Se llama en paralelo a esos campos, nunca en
 * reemplazo. `opportunityId` arranca null -- se completa después, cuando
 * (si) esta conversación deriva en una oportunidad real (ver
 * linkAttributionToOpportunity).
 */
export async function recordAttributionTouch(params: {
  organizationId: string;
  contactId: string;
  conversationId: string;
  adReferral: AdReferralInfo & Partial<AdInfo>;
}): Promise<void> {
  const { organizationId, contactId, conversationId, adReferral } = params;
  await prisma.metaAttributionTouch.create({
    data: {
      organizationId,
      contactId,
      conversationId,
      ctwaClid: adReferral.ctwaClid ?? null,
      sourceId: adReferral.sourceId ?? null,
      sourceType: adReferral.sourceType ?? null,
      sourceUrl: adReferral.sourceUrl ?? null,
      referralJson: adReferral as unknown as Prisma.InputJsonValue,
      adAccountId: adReferral.adAccountId ?? null,
      campaignId: adReferral.campaignId ?? null,
      campaignName: adReferral.campaignName ?? null,
      adsetId: adReferral.adsetId ?? null,
      adsetName: adReferral.adsetName ?? null,
      adId: adReferral.sourceId ?? null,
      adName: adReferral.adName ?? null,
    },
  });
}

/**
 * Cuando una conversación deriva en una oportunidad real, liga el touch de
 * atribución de ESA conversación puntual a la oportunidad nueva -- es lo
 * que permite reportar la venta a Meta (reportOpportunityWon) con la
 * atribución ya resuelta desde la oportunidad en vez de tener que
 * rebuscarla por teléfono. No hace nada si la conversación no tiene ningún
 * touch (lead orgánico, no vino de un anuncio).
 */
export async function linkAttributionToOpportunity(
  conversationId: string,
  opportunityId: string,
): Promise<void> {
  await prisma.metaAttributionTouch.updateMany({
    where: { conversationId, opportunityId: null },
    data: { opportunityId },
  });
}
