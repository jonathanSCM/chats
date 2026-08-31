-- Bot de calificación por WhatsApp: activación por cuenta y memoria del
-- bot mientras todavía no existe una Opportunity donde guardarla.
ALTER TABLE "bots" ADD COLUMN "aiQualificationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN "botMemory" TEXT;
