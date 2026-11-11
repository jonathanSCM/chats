-- Cada grabación de la extensión de Chrome tiene su propio id: dos grabaciones seguidas en la misma sala son reuniones separadas. Aditivo.
ALTER TABLE "meetings" ADD COLUMN "extensionRecordingId" TEXT;
CREATE INDEX "meetings_organizationId_extensionRecordingId_idx" ON "meetings"("organizationId", "extensionRecordingId");
