-- Limpieza de la herencia del fork SaaS (planes, suscripciones, facturación,
-- configuración del bot y catálogo) + base de conocimiento editable desde el panel.

-- Base de conocimiento
CREATE TYPE "KnowledgeCategory" AS ENUM (
    'SERVICE', 'PRICING', 'SCOPE', 'EXCLUSION', 'FAQ',
    'POLICY', 'CASE_STUDY', 'QUALIFICATION', 'TONE'
);

CREATE TABLE "knowledge_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" "KnowledgeCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_items_organizationId_category_idx" ON "knowledge_items"("organizationId", "category");

ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migra el catálogo existente a la base de conocimiento antes de borrarlo,
-- para no perder lo que ya estuviera cargado.
INSERT INTO "knowledge_items" ("id", "organizationId", "category", "title", "content", "active", "createdAt", "updatedAt")
SELECT
    ci."id",
    b."organizationId",
    'SERVICE'::"KnowledgeCategory",
    ci."name",
    COALESCE(ci."description", '') ||
        CASE WHEN ci."price" IS NOT NULL THEN E'\n\nPrecio: ' || ci."price"::text ELSE '' END,
    ci."active",
    ci."createdAt",
    ci."updatedAt"
FROM "catalog_items" ci
JOIN "bots" b ON b."id" = ci."botId";

-- Fuera la facturación SaaS: este producto atiende a un solo negocio.
DROP TABLE IF EXISTS "usage_records";
DROP TABLE IF EXISTS "subscriptions";
DROP TABLE IF EXISTS "plans";
DROP TYPE IF EXISTS "UsageType";
DROP TYPE IF EXISTS "SubscriptionStatus";

-- Fuera la configuración del chatbot: el sistema asiste al vendedor, no lo sustituye.
DROP TABLE IF EXISTS "bot_configs";
DROP TABLE IF EXISTS "catalog_items";
