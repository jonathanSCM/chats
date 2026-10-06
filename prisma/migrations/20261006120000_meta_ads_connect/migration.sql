ALTER TABLE "organizations" ADD COLUMN "metaAdAccountName" TEXT;
ALTER TABLE "organizations" ADD COLUMN "metaAdsAccessToken" TEXT;
ALTER TABLE "organizations" ADD COLUMN "metaAdsTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "metaAdsConnectedAt" TIMESTAMP(3);
ALTER TABLE "platform_settings" ADD COLUMN "metaAdsConfigId" TEXT;
