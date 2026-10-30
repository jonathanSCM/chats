-- Planes comerciales: plantilla de lo que incluye cada plan + precio anotado. Aditivo.
-- Una organización sin plan (planId NULL) sigue exactamente como estaba.
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceSoles" DECIMAL(10,2),
    "maxAdmins" INTEGER,
    "maxSellers" INTEGER,
    "canHaveSubOrgs" BOOLEAN NOT NULL DEFAULT false,
    "maxSubOrgs" INTEGER,
    "canCustomizeBrand" BOOLEAN NOT NULL DEFAULT false,
    "aiCreditsMonthly" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

ALTER TABLE "organizations" ADD COLUMN "planId" TEXT;
ALTER TABLE "organizations" ADD COLUMN "planNoticeMessage" TEXT;
ALTER TABLE "organizations" ADD COLUMN "planNoticeAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "organizations_planId_idx" ON "organizations"("planId");
