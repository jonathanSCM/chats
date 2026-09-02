import { enqueueOrReschedule, runJobsSoon } from "@/server/jobs";
import { prisma } from "@/server/db/client";

/**
 * El servicio del bot (Xvfb+Chromium+ffmpeg, `meeting-bot/`) vive aparte,
 * desplegado como otra app en Coolify. Sin estas dos variables, simplemente
 * no se programa el job — el link de Meet se genera igual (Fase 1), solo que
 * nadie entra a grabar.
 */
export function isMeetingBotEnabled(): boolean {
  return Boolean(process.env.BOT_SERVICE_URL && process.env.BOT_SERVICE_SECRET);
}

/**
 * Encola (o reprograma si ya estaba encolado) que el bot entre a esta
 * reunión un minuto antes de la hora agendada. `uniqueKey` por meetingId:
 * si la reunión se vuelve a guardar con otra hora, esto reemplaza el job
 * anterior en vez de duplicarlo.
 */
export async function scheduleMeetingBotJoin(meetingId: string, scheduledAt: Date): Promise<void> {
  if (!isMeetingBotEnabled()) return;
  if (scheduledAt.getTime() <= Date.now()) return; // ya pasó, no tiene sentido encolar

  await enqueueOrReschedule({
    type: "meeting_bot_join",
    uniqueKey: `meeting-bot-${meetingId}`,
    payload: { meetingId },
    runAfter: new Date(scheduledAt.getTime() - 60_000),
  });

  // Visible para el usuario de inmediato ("se va a grabar"), aunque el job
  // recién dispare más cerca de la hora — sin esto, botStatus queda null
  // (indistinguible de "no se pidió bot") hasta el minuto exacto.
  await prisma.meeting.update({ where: { id: meetingId }, data: { botStatus: "PENDING" } });
}

/**
 * "Unir el bot ya mismo" — para cuando alguien ya está en una reunión en
 * vivo y quiere que se sume a grabar sin esperar nada agendado. Encola con
 * `runAfter: ahora` (en vez de esperar a un `scheduledAt` futuro) y dispara
 * `runJobsSoon()` para que no haya que esperar al próximo tick del cron
 * (hasta 1 minuto) — el mismo patrón que ya usa el webhook de WhatsApp.
 */
export async function scheduleMeetingBotJoinNow(meetingId: string): Promise<void> {
  if (!isMeetingBotEnabled()) return;

  await enqueueOrReschedule({
    type: "meeting_bot_join",
    uniqueKey: `meeting-bot-${meetingId}`,
    payload: { meetingId },
    runAfter: new Date(),
  });

  await prisma.meeting.update({ where: { id: meetingId }, data: { botStatus: "PENDING" } });
  runJobsSoon();
}

/**
 * "Salir de la reunión" a mano — le pega directo al servicio del bot
 * (`POST /stop`), que corta la grabación ahí mismo y sube lo que tenga
 * hasta ese momento (no espera a que la app principal reprocese nada). El
 * `botStatus` lo actualiza el propio bot al terminar de subir, como
 * cualquier fin de reunión normal — acá no se toca a propósito.
 */
export async function stopMeetingBot(meetingId: string): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.BOT_SERVICE_URL;
  const secret = process.env.BOT_SERVICE_SECRET;
  if (!url || !secret) {
    return { ok: false, error: "El bot no está configurado en el servidor." };
  }

  try {
    const response = await fetch(`${url}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ meetingId }),
    });
    if (!response.ok) {
      const detail = response.status === 404 ? "El bot no tiene ninguna sesión activa para esta reunión." : `El servicio del bot respondió ${response.status}.`;
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo contactar al servicio del bot." };
  }
}
