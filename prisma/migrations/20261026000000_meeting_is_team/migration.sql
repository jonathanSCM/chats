-- Marca de "reunión del equipo": el Jefe de Operaciones solo analiza estas
ALTER TABLE "meetings" ADD COLUMN "isTeam" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "meetings_organizationId_isTeam_updatedAt_idx" ON "meetings"("organizationId", "isTeam", "updatedAt");
