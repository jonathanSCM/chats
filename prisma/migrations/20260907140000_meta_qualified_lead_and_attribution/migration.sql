-- Fase 1 de cumplimiento Meta Ads: marca de "lead calificado" (se dispara la
-- primera vez que una oportunidad pasa de POR_CALIFICAR a ENTREVISTA) y
-- marcadores de envío por tipo de evento, separados del legado
-- metaConversionSentAt (Purchase) para no romper lo que ya está en
-- producción. event_id es determinístico, no un UUID por reintento.
ALTER TABLE "opportunities" ADD COLUMN "qualifiedAt" TIMESTAMP(3);
ALTER TABLE "opportunities" ADD COLUMN "qualifiedEventSentAt" TIMESTAMP(3);
ALTER TABLE "opportunities" ADD COLUMN "qualifiedEventId" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "purchaseEventSentAt" TIMESTAMP(3);
ALTER TABLE "opportunities" ADD COLUMN "purchaseEventId" TEXT;

-- Registro append-only de cada clic de anuncio que generó contacto (no solo
-- el más reciente por Conversation): el primer touch de un contacto nunca
-- se pisa, uno nuevo siempre agrega una fila.
CREATE TABLE "meta_attribution_touches" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "opportunityId" TEXT,
  "sourcePlatform" TEXT NOT NULL DEFAULT 'meta',
  "sourceChannel" TEXT NOT NULL DEFAULT 'whatsapp',
  "ctwaClid" TEXT,
  "sourceId" TEXT,
  "sourceType" TEXT,
  "sourceUrl" TEXT,
  "referralJson" JSONB,
  "adAccountId" TEXT,
  "campaignId" TEXT,
  "campaignName" TEXT,
  "adsetId" TEXT,
  "adsetName" TEXT,
  "adId" TEXT,
  "adName" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meta_attribution_touches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meta_attribution_touches_organizationId_contactId_capturedAt_idx"
  ON "meta_attribution_touches" ("organizationId", "contactId", "capturedAt");
CREATE INDEX "meta_attribution_touches_opportunityId_idx"
  ON "meta_attribution_touches" ("opportunityId");

ALTER TABLE "meta_attribution_touches" ADD CONSTRAINT "meta_attribution_touches_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meta_attribution_touches" ADD CONSTRAINT "meta_attribution_touches_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meta_attribution_touches" ADD CONSTRAINT "meta_attribution_touches_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meta_attribution_touches" ADD CONSTRAINT "meta_attribution_touches_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
