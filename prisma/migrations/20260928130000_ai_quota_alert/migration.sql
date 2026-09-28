-- Aviso automático cuando OpenAI se queda sin créditos -- se setea solo
-- desde runStructured() (ai/client.ts) y se limpia solo en la próxima
-- llamada que funcione, sobre la misma fila singleton que ya usa
-- /admin/settings para la config de Meta.
ALTER TABLE "platform_settings" ADD COLUMN "aiQuotaAlertAt" TIMESTAMP(3);
ALTER TABLE "platform_settings" ADD COLUMN "aiQuotaAlertMessage" TEXT;
