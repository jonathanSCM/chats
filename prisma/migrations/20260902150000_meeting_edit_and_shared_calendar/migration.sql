-- Calendario secundario de Google por organización (para poder compartirlo
-- sin filtrar reuniones entre organizaciones de la plataforma).
ALTER TABLE "organizations" ADD COLUMN "googleCalendarId" TEXT;
ALTER TABLE "organizations" ADD COLUMN "googleCalendarShares" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Elegir si el bot se une a una reunión puntual, y guardar el id real del
-- evento de Calendar para poder editarlo/cancelarlo después.
ALTER TABLE "meetings" ADD COLUMN "botEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "meetings" ADD COLUMN "googleEventId" TEXT;
