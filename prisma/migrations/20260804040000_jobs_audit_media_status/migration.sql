-- Cola de trabajos en Postgres, auditoría y estado de descarga de media.

CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');
CREATE TYPE "AuditActor" AS ENUM ('USER', 'SYSTEM', 'AI');
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "uniqueKey" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "jobs_uniqueKey_key" ON "jobs"("uniqueKey");
CREATE INDEX "jobs_status_runAfter_idx" ON "jobs"("status", "runAfter");

CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "actor" "AuditActor" NOT NULL DEFAULT 'USER',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

ALTER TABLE "messages" ADD COLUMN "mediaStatus" "MediaStatus";

-- Los mensajes con media ya guardada quedan como READY para no mostrarlos
-- como "descargando" para siempre.
UPDATE "messages" SET "mediaStatus" = 'READY' WHERE "mediaType" IS NOT NULL AND "mediaUrl" IS NOT NULL;
UPDATE "messages" SET "mediaStatus" = 'FAILED' WHERE "mediaType" IS NOT NULL AND "mediaUrl" IS NULL;
