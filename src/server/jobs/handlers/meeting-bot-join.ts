import { z } from "zod";
import { prisma } from "@/server/db/client";
import { enqueueOrReschedule } from "../queue";
import { extractMeetCode } from "@/server/services/meeting-bot";

export const meetingBotJoinPayload = z.object({
  meetingId: z.string(),
});

function vexaConfig(): { url: string; apiKey: string } | null {
  const url = process.env.VEXA_API_URL;
  const apiKey = process.env.VEXA_API_KEY;
  if (!url || !apiKey) return null;
  return { url, apiKey };
}

/**
 * Le pide a Vexa (bot de reuniones auto-alojado, ver `meeting-bot.ts`) que
 * entre a la reunión. Vexa hace todo el resto (unirse, grabar, transcribir)
 * de forma asíncrona de su lado — este handler solo dispara el `POST /bots`,
 * marca el estado, y encola el primer tick de `vexa_bot_poll`, que es el que
 * va siguiendo el progreso y cierra el ciclo (reemplaza al webhook que usaba
 * el bot casero, que no aplica acá).
 */
export async function handleMeetingBotJoin(rawPayload: unknown): Promise<void> {
  const { meetingId } = meetingBotJoinPayload.parse(rawPayload);

  const config = vexaConfig();
  if (!config) {
    console.warn("[meeting-bot] VEXA_API_URL/VEXA_API_KEY no configurados — se omite el job.");
    return;
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      meetingUrl: true,
      status: true,
      organization: { select: { name: true } },
    },
  });
  if (!meeting || !meeting.meetingUrl || meeting.status === "CANCELED") return;

  const code = extractMeetCode(meeting.meetingUrl);
  if (!code) {
    throw new Error("El link de la reunión no es un link de Google Meet válido.");
  }

  const response = await fetch(`${config.url}/bots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
    body: JSON.stringify({
      platform: "google_meet",
      native_meeting_id: code,
      bot_name: `Asistente de ${meeting.organization.name}`,
      language: "es",
    }),
  });

  if (!response.ok) {
    throw new Error(`El servicio del bot respondió ${response.status} al pedirle que se una.`);
  }

  await prisma.meeting.update({ where: { id: meetingId }, data: { botStatus: "JOINING" } });

  await enqueueOrReschedule({
    type: "vexa_bot_poll",
    uniqueKey: `vexa-poll-${meetingId}`,
    payload: { meetingId, nativeMeetingId: code, startedAt: new Date().toISOString() },
    runAfter: new Date(Date.now() + 15_000),
  });
}

/** Se agotaron los reintentos de pedirle al bot que entre — queda visible como fallido. */
export async function markMeetingBotJoinFailed(rawPayload: unknown): Promise<void> {
  const parsed = meetingBotJoinPayload.safeParse(rawPayload);
  if (!parsed.success) return;

  await prisma.meeting.updateMany({
    where: { id: parsed.data.meetingId },
    data: { botStatus: "FAILED" },
  });
}
