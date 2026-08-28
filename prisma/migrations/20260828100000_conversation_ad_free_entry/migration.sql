-- Ventana extendida de 72h para leads de anuncios "Click to WhatsApp"
-- (free entry point), aparte de la ventana normal de 24h.
ALTER TABLE "conversations" ADD COLUMN "adReferral" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN "adReferralAt" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "freeEntryPointUntil" TIMESTAMP(3);
