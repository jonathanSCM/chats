import { enqueueOrReschedule } from "@/server/jobs";
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
