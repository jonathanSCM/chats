-- Créditos de IA (1 crédito = US$0,001): bolsa mensual por organización + paquetes comprados + registro de consumo.
-- Aditivo: sin aiCreditsMonthly (null) la organización se comporta exactamente como antes.
ALTER TABLE "organizations" ADD COLUMN "aiCreditsMonthly" INTEGER;

CREATE TABLE "ai_credit_packs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_credit_packs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_credit_packs_organizationId_expiresAt_idx" ON "ai_credit_packs"("organizationId", "expiresAt");
ALTER TABLE "ai_credit_packs" ADD CONSTRAINT "ai_credit_packs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_credit_usages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "feature" TEXT NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "audioMinutes" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL,
    "fromMonthly" INTEGER NOT NULL,
    "fromPacks" INTEGER NOT NULL,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_credit_usages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_credit_usages_organizationId_createdAt_idx" ON "ai_credit_usages"("organizationId", "createdAt");
ALTER TABLE "ai_credit_usages" ADD CONSTRAINT "ai_credit_usages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
