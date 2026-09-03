-- Dataset de la Conversions API por WABA (se pide una sola vez, la API es
-- idempotente) y marca de "ya se le avisó a Meta" por oportunidad (Meta no
-- deduplica estos eventos del lado de ellos).
ALTER TABLE "whatsapp_connections" ADD COLUMN "metaDatasetId" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "metaConversionSentAt" TIMESTAMP(3);
