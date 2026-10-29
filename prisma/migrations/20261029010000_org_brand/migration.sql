-- Marca propia por organización (solo se muestra si el plan lo permite). Aditivo: todo nace vacío.
ALTER TABLE "organizations" ADD COLUMN "brandName" TEXT;
ALTER TABLE "organizations" ADD COLUMN "brandColor" TEXT;
ALTER TABLE "organizations" ADD COLUMN "assistantName" TEXT;
ALTER TABLE "organizations" ADD COLUMN "brandLogoVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "organization_brand_logos" (
    "organizationId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organization_brand_logos_pkey" PRIMARY KEY ("organizationId")
);

ALTER TABLE "organization_brand_logos" ADD CONSTRAINT "organization_brand_logos_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
