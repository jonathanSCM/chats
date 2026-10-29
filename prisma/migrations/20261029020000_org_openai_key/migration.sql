-- Clave de OpenAI propia por organización (cifrada) y aviso cuando falla. Aditivo: todo nace vacío.
ALTER TABLE "organizations" ADD COLUMN "openaiKeyEnc" TEXT;
ALTER TABLE "organizations" ADD COLUMN "openaiKeyLast4" TEXT;
ALTER TABLE "organizations" ADD COLUMN "aiKeyAlertAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "aiKeyAlertMessage" TEXT;
