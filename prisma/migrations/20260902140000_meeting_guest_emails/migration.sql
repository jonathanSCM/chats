-- Correos invitados a la reunión — si se creó con Google Meet, Calendar
-- les manda la invitación real (ver createMeetEvent en google-calendar.ts).
ALTER TABLE "meetings" ADD COLUMN "guestEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
