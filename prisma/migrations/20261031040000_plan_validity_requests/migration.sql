-- Vigencia del plan (desde/hasta) y solicitudes de créditos o renovación. Aditivo: sin fechas, la organización no vence.
ALTER TABLE "organizations" ADD COLUMN "planStartedAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "planEndsAt" TIMESTAMP(3);

CREATE TABLE "credit_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "kind" TEXT NOT NULL,
    "credits" INTEGER,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "credit_requests_status_createdAt_idx" ON "credit_requests"("status", "createdAt");
CREATE INDEX "credit_requests_organizationId_createdAt_idx" ON "credit_requests"("organizationId", "createdAt");
ALTER TABLE "credit_requests" ADD CONSTRAINT "credit_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
