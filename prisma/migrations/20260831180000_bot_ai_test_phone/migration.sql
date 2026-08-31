-- Modo de prueba del bot de calificación: si se carga un teléfono, el bot
-- solo contesta ese número aunque esté activado para toda la cuenta.
ALTER TABLE "bots" ADD COLUMN "aiTestPhone" TEXT;
