-- Meta avisó (PARTNER_REMOVED) que el número se desconectó de la plataforma: se guarda cuándo y por qué. Aditivo.
ALTER TABLE "whatsapp_connections" ADD COLUMN "disconnectedAt" TIMESTAMP(3);
ALTER TABLE "whatsapp_connections" ADD COLUMN "disconnectReason" TEXT;
