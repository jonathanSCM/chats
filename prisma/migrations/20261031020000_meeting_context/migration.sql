-- Contexto interno de la reunión (escrito por una persona; no se envía al cliente). Aditivo, nace vacío.
ALTER TABLE "meetings" ADD COLUMN "context" TEXT;
