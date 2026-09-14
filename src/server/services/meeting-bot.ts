import { enqueueOrReschedule, cancelJob, runJobsSoon } from "@/server/jobs";
import { prisma } from "@/server/db/client";

/**
 * El bot que se une a las reuniones es Vexa (github.com/Vexa-ai/vexa,
 * auto-alojado aparte en el mismo servidor) — reemplazó al bot casero
 * (`meeting-bot/`, Playwright a mano) porque Google Meet empezó a bloquearlo
 * de forma persistente con una verificación anti-bot explícita, sin importar
 * los ajustes de fingerprint que se probaron. Sin estas dos variables,
 * simplemente no se programa el job — el link de Meet se genera igual (Fase
 * 1), solo que nadie entra a grabar.
 */
export function isMeetingBotEnabled(): boolean {
  return Boolean(process.env.VEXA_API_URL && process.env.VEXA_API_KEY);
}

/** El código de la reunión (lo que va después de "meet.google.com/"). */
export function extractMeetCode(meetingUrl: string): string | null {
  const match = meetingUrl.match(/meet\.google\.com\/([a-z0-9-]+)/i);
  return match ? match[1] : null;
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
 * Saca al bot de una reunión que todavía no arrancó (se apagó "que el bot
 * se una", o se canceló la reunión) — distinto de `stopMeetingBot`, que es
 * para cortar una grabación que ya está en curso. Si el bot ya entró
 * (`botStatus` más allá de PENDING), no se toca nada acá: usar
 * `stopMeetingBot` para eso.
 */
export async function cancelMeetingBotJoin(meetingId: string): Promise<void> {
  await cancelJob(`meeting-bot-${meetingId}`);
  await prisma.meeting.updateMany({
    where: { id: meetingId, botStatus: "PENDING" },
    data: { botStatus: null },
  });
}

/**
 * "Salir de la reunión" a mano — le pide a Vexa que corte esa sesión ahí
 * mismo. El `botStatus` final lo deja el próximo tick de `vexa_bot_poll`
 * (que ya está encolado) al ver que la reunión pasó a un estado terminal —
 * acá no se toca a propósito, para no pisar una transcripción que todavía se
 * esté terminando de armar del lado de Vexa.
 */
export async function stopMeetingBot(meetingId: string): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.VEXA_API_URL;
  const apiKey = process.env.VEXA_API_KEY;
  if (!url || !apiKey) {
    return { ok: false, error: "El bot no está configurado en el servidor." };
  }

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { meetingUrl: true } });
  const code = meeting?.meetingUrl ? extractMeetCode(meeting.meetingUrl) : null;
  if (!code) {
    return { ok: false, error: "Esta reunión no tiene un link de Meet válido." };
  }

  try {
    const response = await fetch(`${url}/bots/google_meet/${code}`, {
      method: "DELETE",
      headers: { "X-API-Key": apiKey },
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

/**
 * Transcribe un audio suelto con whisper.cpp -- reutiliza el mismo servicio
 * del bot grabador (ya tiene el binario y el modelo instalados) en vez de
 * duplicarlos en la imagen de esta app. La usa api/extension/audio para el
 * audio que graba la extensión de subtítulos de Meet en el navegador
 * (tabCapture + micrófono), que no tiene nada que ver con que el bot entre a
 * ninguna reunión.
 */
export async function transcribeAudioViaBotService(
  buffer: Buffer,
  mimeType: string,
): Promise<{ ok: true; transcript: string } | { ok: false; error: string }> {
  const url = process.env.BOT_SERVICE_URL;
  const secret = process.env.BOT_SERVICE_SECRET;
  if (!url || !secret) {
    return { ok: false, error: "El servicio del bot no está configurado en el servidor." };
  }

  try {
    const response = await fetch(`${url}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": mimeType, Authorization: `Bearer ${secret}` },
      body: new Uint8Array(buffer),
    });
    const data = (await response.json().catch(() => null)) as { transcript?: string; error?: string } | null;
    if (!response.ok || !data?.transcript) {
      return { ok: false, error: data?.error || `El servicio del bot respondió ${response.status}.` };
    }
    return { ok: true, transcript: data.transcript };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo contactar al servicio del bot." };
  }
}
