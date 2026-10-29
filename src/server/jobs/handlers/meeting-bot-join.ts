import { z } from "zod";
import { prisma } from "@/server/db/client";
import { enqueueOrReschedule } from "../queue";
import { extractMeetCode } from "@/server/services/meeting-bot";
import { assistantDisplayName, resolveBrand } from "@/lib/brand";

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
      organization: {
        select: {
          id: true,
          name: true,
          canCustomizeBrand: true,
          brandName: true,
          brandColor: true,
          assistantName: true,
          brandLogoVersion: true,
        },
      },
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
      bot_name: assistantDisplayName(resolveBrand(meeting.organization), meeting.organization.name),
      language: "es",
    }),
  });

  // 409 = Vexa ya tiene un bot en esa sala (el pedido anterior sí entró). No es un fallo: reintentar
  // solo generaba errores en cadena, y al agotarse los reintentos la reunión quedaba marcada como
  // FALLIDA con el bot dentro -- o volvía a pedirlo cuando el bot ya había salido.
  const alreadyThere = response.status === 409;
  if (!response.ok && !alreadyThere) {
    throw new Error(`El servicio del bot respondió ${response.status} al pedirle que se una.`);
  }

  await prisma.meeting.updateMany({
    where: alreadyThere
      ? { id: meetingId, OR: [{ botStatus: null }, { botStatus: "PENDING" }] }
      : { id: meetingId },
    data: { botStatus: "JOINING" },
  });

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
