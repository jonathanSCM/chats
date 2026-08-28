-- Bloquear una conversación (impide seguir mandándole mensajes) sin borrar
-- el historial. "Archivar" reusa el status CLOSED que ya existía.
ALTER TABLE "conversations" ADD COLUMN "blocked" BOOLEAN NOT NULL DEFAULT false;
