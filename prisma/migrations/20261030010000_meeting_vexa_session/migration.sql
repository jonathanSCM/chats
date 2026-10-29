-- Id interno de la sesión del bot en Vexa (la sesión, no el código de la sala). Aditivo, nace vacío.
ALTER TABLE "meetings" ADD COLUMN "vexaSessionId" INTEGER;
CREATE INDEX "meetings_vexaSessionId_idx" ON "meetings"("vexaSessionId");
