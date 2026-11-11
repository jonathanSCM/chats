-- Seguimiento automático de leads (tarjeta + análisis de IA sin intervención). Apagado por defecto. Aditivo.
ALTER TABLE "organizations" ADD COLUMN "autoTrackLeads" BOOLEAN NOT NULL DEFAULT false;
