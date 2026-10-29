-- Tres modos de IA por organización (plataforma / personalizada con tope mensual / propia) y tamaño del logo.
-- Aditivo. Las organizaciones que ya tenían habilitada la clave propia pasan al modo "own".
ALTER TABLE "organizations" ADD COLUMN "aiMode" TEXT NOT NULL DEFAULT 'platform';
ALTER TABLE "organizations" ADD COLUMN "customKeyEnc" TEXT;
ALTER TABLE "organizations" ADD COLUMN "customKeyLast4" TEXT;
ALTER TABLE "organizations" ADD COLUMN "aiMonthlyBudgetUsd" DOUBLE PRECISION;
ALTER TABLE "organizations" ADD COLUMN "aiMonthlyTokenLimit" INTEGER;
ALTER TABLE "organizations" ADD COLUMN "brandLogoScale" INTEGER NOT NULL DEFAULT 100;

UPDATE "organizations" SET "aiMode" = 'own' WHERE "aiOwnKeyEnabled" = true;
