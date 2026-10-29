-- Plan por organización (lo fija el superadmin) y jerarquía de suborganizaciones. Todo aditivo:
-- todo nace apagado/vacío, así que las organizaciones existentes no cambian.
ALTER TABLE "organizations" ADD COLUMN "canHaveSubOrgs" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "maxSubOrgs" INTEGER;
ALTER TABLE "organizations" ADD COLUMN "maxAdmins" INTEGER;
ALTER TABLE "organizations" ADD COLUMN "maxSellers" INTEGER;
ALTER TABLE "organizations" ADD COLUMN "canCustomizeBrand" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "aiOwnKeyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN "parentId" TEXT;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "organizations_parentId_idx" ON "organizations"("parentId");
