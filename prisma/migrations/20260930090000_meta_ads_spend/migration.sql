-- Fase 4: cuenta publicitaria de Meta por organización + histórico de gasto por anuncio
ALTER TABLE "organizations" ADD COLUMN "metaAdAccountId" TEXT;
ALTER TABLE "organizations" ADD COLUMN "metaAdsLastSyncedAt" TIMESTAMP(3);

CREATE TABLE "ad_spend_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "adsetId" TEXT NOT NULL,
    "adsetName" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "adName" TEXT NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "reach" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "ctr" DECIMAL(8,4),
    "cpc" DECIMAL(10,4),
    "cpm" DECIMAL(10,4),
    "frequency" DECIMAL(8,4),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_spend_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ad_spend_snapshots_organizationId_adId_date_key" ON "ad_spend_snapshots"("organizationId", "adId", "date");

CREATE INDEX "ad_spend_snapshots_organizationId_date_idx" ON "ad_spend_snapshots"("organizationId", "date");

ALTER TABLE "ad_spend_snapshots" ADD CONSTRAINT "ad_spend_snapshots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
