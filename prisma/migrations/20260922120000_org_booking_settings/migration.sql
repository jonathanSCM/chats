-- Horario habilitado para que el bot de calificación ofrezca reuniones,
-- configurable por organización (ver server/services/availability.ts).
ALTER TABLE "organizations"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/La_Paz',
  ADD COLUMN "bookingDays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::INTEGER[],
  ADD COLUMN "bookingStartHour" INTEGER NOT NULL DEFAULT 9,
  ADD COLUMN "bookingEndHour" INTEGER NOT NULL DEFAULT 18,
  ADD COLUMN "bookingDurationMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "bookingLeadHours" INTEGER NOT NULL DEFAULT 4;
