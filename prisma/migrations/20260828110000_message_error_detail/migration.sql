-- Motivo legible cuando un mensaje saliente falla (ej. 131047: fuera de
-- ventana, hace falta plantilla), para no dejar solo un ícono de alerta
-- sin explicación en el panel.
ALTER TABLE "messages" ADD COLUMN "errorDetail" TEXT;
