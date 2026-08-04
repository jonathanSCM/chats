-- CRM núcleo: empresas, contactos, oportunidades, actividades y reuniones.
-- Incluye el traslado de las conversaciones existentes a fichas de contacto.

CREATE TYPE "OpportunityStage" AS ENUM (
    'NEW', 'CONTACTED', 'QUALIFYING', 'MEETING_SCHEDULED', 'NEED_CONFIRMED',
    'PROPOSAL_DRAFT', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST', 'ON_HOLD'
);
CREATE TYPE "DataStatus" AS ENUM ('CONFIRMED', 'INFERRED', 'UNKNOWN');
CREATE TYPE "ActivityType" AS ENUM ('TASK', 'CALL', 'MESSAGE', 'PROPOSAL', 'FOLLOW_UP');
CREATE TYPE "ActivityStatus" AS ENUM ('PENDING', 'DONE', 'CANCELED');
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'DONE', 'CANCELED', 'NO_SHOW');

CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "size" TEXT,
    "website" TEXT,
    "city" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "companies_organizationId_idx" ON "companies"("organizationId");

CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "jobTitle" TEXT,
    "city" TEXT,
    "country" TEXT,
    "source" TEXT,
    "companyId" TEXT,
    "assignedToId" TEXT,
    "firstContactAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastContactAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contacts_organizationId_phone_key" ON "contacts"("organizationId", "phone");
CREATE INDEX "contacts_organizationId_idx" ON "contacts"("organizationId");

CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "title" TEXT NOT NULL,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'NEW',
    "serviceInterest" TEXT,
    "estimatedValue" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "probability" INTEGER,
    "expectedCloseDate" TIMESTAMP(3),
    "leadScore" INTEGER,
    "needSummary" TEXT,
    "needStatus" "DataStatus" NOT NULL DEFAULT 'UNKNOWN',
    "budgetRange" TEXT,
    "budgetStatus" "DataStatus" NOT NULL DEFAULT 'UNKNOWN',
    "urgency" TEXT,
    "authorityLevel" TEXT,
    "nextAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "proposalSentAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "opportunities_organizationId_stage_idx" ON "opportunities"("organizationId", "stage");
CREATE INDEX "opportunities_contactId_idx" ON "opportunities"("contactId");

CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT,
    "opportunityId" TEXT,
    "assignedToId" TEXT,
    "type" "ActivityType" NOT NULL DEFAULT 'TASK',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "ActivityStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "activities_organizationId_status_dueAt_idx" ON "activities"("organizationId", "status", "dueAt");
CREATE INDEX "activities_opportunityId_idx" ON "activities"("opportunityId");

CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "meetingUrl" TEXT,
    "location" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "aiSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "meetings_organizationId_scheduledAt_idx" ON "meetings"("organizationId", "scheduledAt");

ALTER TABLE "conversations" ADD COLUMN "contactId" TEXT;
CREATE INDEX "conversations_contactId_idx" ON "conversations"("contactId");

-- Claves foráneas
ALTER TABLE "companies" ADD CONSTRAINT "companies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activities" ADD CONSTRAINT "activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Traslado de datos ──────────────────────────────────────────
-- Cada teléfono que ya conversó se convierte en un contacto, conservando
-- el nombre de perfil de WhatsApp y las fechas reales de contacto.
INSERT INTO "contacts" ("id", "organizationId", "fullName", "phone", "source", "assignedToId", "firstContactAt", "lastContactAt", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    agg."organizationId",
    agg."customerName",
    agg."customerPhone",
    'whatsapp',
    agg."assignedToId",
    agg."firstAt",
    agg."lastAt",
    NOW(),
    NOW()
FROM (
    SELECT
        b."organizationId",
        c."customerPhone",
        -- Puede haber varias conversaciones del mismo número: se toma el
        -- nombre y el vendedor de la más reciente.
        (ARRAY_AGG(c."customerName" ORDER BY c."lastMessageAt" DESC) FILTER (WHERE c."customerName" IS NOT NULL))[1] AS "customerName",
        (ARRAY_AGG(c."assignedToId" ORDER BY c."lastMessageAt" DESC) FILTER (WHERE c."assignedToId" IS NOT NULL))[1] AS "assignedToId",
        MIN(c."startedAt") AS "firstAt",
        MAX(c."lastMessageAt") AS "lastAt"
    FROM "conversations" c
    JOIN "bots" b ON b."id" = c."botId"
    GROUP BY b."organizationId", c."customerPhone"
) agg;

UPDATE "conversations" c
SET "contactId" = ct."id"
FROM "contacts" ct, "bots" b
WHERE b."id" = c."botId"
  AND ct."organizationId" = b."organizationId"
  AND ct."phone" = c."customerPhone";
