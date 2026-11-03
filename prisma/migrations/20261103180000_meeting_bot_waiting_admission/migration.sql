-- El asistente de reuniones distingue "esperando que lo admitan" y guarda por qué falló. Aditivo.
ALTER TYPE "MeetingBotStatus" ADD VALUE 'WAITING_ADMISSION';
ALTER TABLE "meetings" ADD COLUMN "botFailureReason" TEXT;
