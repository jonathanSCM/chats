-- Asignación automática de leads (F14). Migración aditiva: todo apagado por defecto.

ALTER TABLE "organizations"
  ADD COLUMN "autoAssignEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoAssignMaxOpen" INTEGER,
  ADD COLUMN "autoAssignSlaMinutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "autoAssignLastUserId" TEXT;

ALTER TABLE "organization_memberships"
  ADD COLUMN "availableForLeads" BOOLEAN NOT NULL DEFAULT true;

-- Quien ya es administrador (OWNER) no entra al reparto salvo que se lo active a mano.
UPDATE "organization_memberships" SET "availableForLeads" = false WHERE "role" = 'OWNER';

ALTER TABLE "conversations"
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "autoAssigned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "slaAlertedAt" TIMESTAMP(3),
  ADD COLUMN "slaReassignedAt" TIMESTAMP(3);
