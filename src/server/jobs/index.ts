import { claimJobs, completeJob, failJob, requeueStaleJobs } from "./queue";
import { handleDownloadMedia, markMediaFailed } from "./handlers/download-media";
import { handleAnalyzeFollowUp } from "./handlers/analyze-follow-up";
import { handleBotReply } from "./handlers/bot-reply";
import { handleMeetingBotJoin, markMeetingBotJoinFailed } from "./handlers/meeting-bot-join";
import { markBotReplyFailed } from "@/server/services/ai/qualification-bot";

export { enqueue, enqueueOrReschedule, cancelJob } from "./queue";

type JobHandler = (payload: unknown) => Promise<void>;

/** Se ejecuta cuando un job agota sus reintentos, para dejar rastro visible. */
type JobExhaustedHandler = (payload: unknown) => Promise<void>;

const handlers: Record<string, JobHandler> = {
  download_media: handleDownloadMedia,
  analyze_follow_up: handleAnalyzeFollowUp,
  bot_reply: handleBotReply,
  meeting_bot_join: handleMeetingBotJoin,
};

const onExhausted: Record<string, JobExhaustedHandler> = {
  download_media: markMediaFailed,
  bot_reply: markBotReplyFailed,
  meeting_bot_join: markMeetingBotJoinFailed,
};

const BATCH_SIZE = 10;

/**
 * Procesa un lote de trabajos pendientes. Lo invoca el cron cada minuto y
 * también el webhook justo después de encolar, para que en la práctica el
 * trabajo corra en milisegundos y el cron quede solo como red de seguridad.
 */
export async function processJobs(): Promise<{ processed: number; failed: number }> {
  await requeueStaleJobs();

  const jobs = await claimJobs(BATCH_SIZE);
  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    const handler = handlers[job.type];

    if (!handler) {
      await failJob(job, new Error(`No hay handler registrado para el job "${job.type}"`));
      failed++;
      continue;
    }

    try {
      await handler(job.payload);
      await completeJob(job.id);
      processed++;
    } catch (error) {
      console.error(`[jobs] Falló el job ${job.type} (${job.id}):`, error);
      await failJob(job, error);
      failed++;

      if (job.attempts >= job.maxAttempts) {
        await onExhausted[job.type]?.(job.payload).catch(() => {});
      }
    }
  }

  return { processed, failed };
}

let running = false;

/**
 * Dispara el procesamiento sin bloquear a quien lo llama. Pensado para el
 * webhook: responde 200 a Meta de inmediato y el trabajo sigue en el mismo
 * proceso (el servidor es de larga vida, no serverless).
 *
 * El candado evita que varias llamadas seguidas acumulen pasadas; igual el
 * reclamo de la cola es seguro entre procesos gracias a SKIP LOCKED.
 */
export function runJobsSoon(): void {
  if (running) return;
  running = true;

  void (async () => {
    try {
      // Vacía la cola en tandas: si llegaron 30 mensajes de golpe, no se
      // quedan 20 esperando al próximo tick del cron.
      for (;;) {
        const { processed, failed } = await processJobs();
        if (processed + failed === 0) break;
      }
    } catch (error) {
      console.error("[jobs] Error procesando la cola:", error);
    } finally {
      running = false;
    }
  })();
}
