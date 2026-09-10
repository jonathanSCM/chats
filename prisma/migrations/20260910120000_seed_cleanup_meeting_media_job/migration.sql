-- Siembra el job recurrente que borra los adjuntos de reunión (grabación,
-- PDF de resumen, etc.) con más de 7 días, para liberar espacio de
-- almacenamiento. El handler se reprograma a sí mismo cada 24h una vez que
-- corre por primera vez (ver src/server/jobs/handlers/cleanup-meeting-media.ts);
-- esta fila solo dispara la primera corrida.
INSERT INTO "jobs" (
  "id", "type", "payload", "uniqueKey", "status", "runAfter",
  "attempts", "maxAttempts", "createdAt", "updatedAt"
)
VALUES (
  'seed-cleanup-meeting-media-job', 'cleanup_meeting_media', '{}'::jsonb,
  'cleanup_meeting_media_daily', 'PENDING', now(),
  0, 5, now(), now()
)
ON CONFLICT ("uniqueKey") DO NOTHING;
