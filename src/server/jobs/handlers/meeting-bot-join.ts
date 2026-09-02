import { z } from "zod";
import { prisma } from "@/server/db/client";

export const meetingBotJoinPayload = z.object({
  meetingId: z.string(),
});

function botServiceConfig(): { url: string; secret: string } | null {
  const url = process.env.BOT_SERVICE_URL;
  const secret = process.env.BOT_SERVICE_SECRET;
  if (!url || !secret) return null;
  return { url, secret };
}

/**
 * Le avisa al servicio del bot que entre a la reunión. El bot mismo hace
 * todo el resto (unirse, grabar, detectar el final, subir el audio) — este
 * handler solo dispara el `/join` y marca el estado; el resto del ciclo lo
 * cierra el webhook de `api/webhooks/meeting-bot` cuando el audio llega.
 */
export async function handleMeetingBotJoin(rawPayload: unknown): Promise<void> {
  const { meetingId } = meetingBotJoinPayload.parse(rawPayload);

  const config = botServiceConfig();
  if (!config) {
    console.warn("[meeting-bot] BOT_SERVICE_URL/BOT_SERVICE_SECRET no configurados — se omite el job.");
    return;
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, meetingUrl: true, durationMinutes: true, status: true },
  });
  if (!meeting || !meeting.meetingUrl || meeting.status === "CANCELED") return;

  const appUrl = process.env.NEXTAUTH_URL;
  if (!appUrl) {
    throw new Error("NEXTAUTH_URL no está configurada — el bot no tendría a dónde devolver la grabación.");
  }

  const response = await fetch(`${config.url}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.secret}` },
    body: JSON.stringify({
      meetingId: meeting.id,
      meetingUrl: meeting.meetingUrl,
      expectedDurationMinutes: meeting.durationMinutes,
      callbackUrl: `${appUrl}/api/webhooks/meeting-bot`,
    }),
  });

  if (!response.ok) {
    throw new Error(`El servicio del bot respondió ${response.status} al pedirle que se una.`);
  }

  await prisma.meeting.update({ where: { id: meetingId }, data: { botStatus: "JOINING" } });
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
