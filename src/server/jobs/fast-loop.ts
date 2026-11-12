import { processJobs } from "./index";

/**
 * Latido rápido del asistente de reuniones.
 *
 * La cola se procesa al instante cuando algo la dispara (un webhook), pero un trabajo DIFERIDO (`runAfter` en el futuro) solo
 * corre en el siguiente latido del cron, que es una vez por minuto. Con el asistente eso se notaba: el CRM se enteraba de que
 * entró (o de que Meet lo rechazó) hasta un minuto tarde, y cada reintento de entrada esperaba al próximo minuto.
 *
 * Este bucle vive dentro del servidor (de larga vida, no serverless) y cada pocos segundos procesa SOLO los trabajos del
 * asistente que ya les toca. Es seguro con varias réplicas y junto al cron: la cola reparte con FOR UPDATE SKIP LOCKED.
 */
export const BOT_JOB_TYPES = ["meeting_bot_join", "vexa_bot_poll"];
export const FAST_LOOP_MS = 5_000;

let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;

export function startFastBotLoop(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (busy) return; // una pasada a la vez
    busy = true;
    void processJobs({ types: BOT_JOB_TYPES })
      .catch((error) => console.error("[jobs] Error en el latido rápido del asistente:", error))
      .finally(() => {
        busy = false;
      });
  }, FAST_LOOP_MS);
  timer.unref?.(); // no impide que el proceso termine
}

export function stopFastBotLoop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  busy = false;
}
