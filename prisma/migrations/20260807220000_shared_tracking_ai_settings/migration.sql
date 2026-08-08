-- Cuántos mensajes recientes se le mandan al asesor IA por organización.
ALTER TABLE "organizations" ADD COLUMN "aiMessageLimit" INTEGER NOT NULL DEFAULT 25;

-- Memoria viva que la IA mantiene por oportunidad, más allá de la ventana
-- de mensajes recientes que se le manda en cada análisis.
ALTER TABLE "opportunities" ADD COLUMN "aiMemory" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "aiMemoryUpdatedAt" TIMESTAMP(3);
