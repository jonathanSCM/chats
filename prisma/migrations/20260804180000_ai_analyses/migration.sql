-- Registro de llamadas al modelo: tokens, costo y resultado.

CREATE TABLE "ai_analyses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "analysisType" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costEstimate" DECIMAL(10,6),
    "result" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_analyses_organizationId_createdAt_idx" ON "ai_analyses"("organizationId", "createdAt");
CREATE INDEX "ai_analyses_entityType_entityId_idx" ON "ai_analyses"("entityType", "entityId");

ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
