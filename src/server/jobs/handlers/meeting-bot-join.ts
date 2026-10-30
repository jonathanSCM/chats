import { z } from "zod";
import { prisma } from "@/server/db/client";
import { enqueueOrReschedule } from "../queue";
import { extractMeetCode } from "@/server/services/meeting-bot";
import { assistantDisplayName, BRAND_PARENT_SELECT, resolveOrgBrand } from "@/lib/brand";
import { decideConflict, parseSessionId, pickSession, type VexaSessionEntry } from "@/lib/vexa-session";
import { PlanExpiredError, assertPlanActive } from "@/server/services/ai/credits";

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
      organizationId: true,
      vexaSessionId: true,
      organization: {
        select: {
          id: true,
          name: true,
          canCustomizeBrand: true,
          brandName: true,
          brandColor: true,
          assistantName: true,
          brandLogoVersion: true,
          parent: { select: BRAND_PARENT_SELECT },
        },
      },
    },
  });
  if (!meeting || !meeting.meetingUrl || meeting.status === "CANCELED") return;

  // Con el plan vencido (pasada la gracia) el asistente no entra. No se reintenta. Transcribir no gasta créditos, así que
  // quedarse sin créditos no lo detiene (solo el resumen con IA).
  try {
    await assertPlanActive(meeting.organizationId);
  } catch (error) {
    if (!(error instanceof PlanExpiredError)) throw error;
    console.warn(`[meeting-bot] El plan de la organización ${meeting.organizationId} venció — el asistente no entra a ${meetingId}.`);
    await prisma.meeting.update({ where: { id: meetingId }, data: { botStatus: "FAILED" } });
    return;
  }

  const code = extractMeetCode(meeting.meetingUrl);
  if (!code) {
    throw new Error("El link de la reunión no es un link de Google Meet válido.");
  }

  const requestedAt = Date.now();
  const response = await fetch(`${config.url}/bots`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
    body: JSON.stringify({
      platform: "google_meet",
      native_meeting_id: code,
      bot_name: assistantDisplayName(resolveOrgBrand(meeting.organization, meeting.organization.parent), meeting.organization.name),
      language: "es",
    }),
  });

  const listSessions = async (): Promise<VexaSessionEntry[]> => {
    const res = await fetch(`${config.url}/bots`, { headers: { "X-API-Key": config.apiKey } });
    if (!res.ok) throw new Error(`El servicio del bot respondió ${res.status} al consultar sus sesiones.`);
    return ((await res.json()) as { meetings?: VexaSessionEntry[] }).meetings ?? [];
  };

  let sessionId: number | null = null;

  if (response.status === 409) {
    // Vexa ya tiene un bot en esa sala. Solo se adopta esa sesión si es de ESTA organización (la propia reunión
    // ya la tenía, u otra reunión de la misma organización la inició); si la inició otra organización no se toca,
    // para no quedarse con una copia de lo que graba otra.
    const sameOrg = await prisma.meeting.findMany({
      where: { organizationId: meeting.organizationId, vexaSessionId: { not: null } },
      select: { vexaSessionId: true },
    });
    const decision = decideConflict({
      list: await listSessions(),
      nativeId: code,
      ownSessionId: meeting.vexaSessionId,
      sameOrgSessionIds: new Set(sameOrg.map((m) => m.vexaSessionId as number)),
    });
    if (decision.action === "retry") {
      throw new Error("El servicio del bot dice que ya hay un asistente en la sala, pero todavía no aparece su sesión.");
    }
    if (decision.action === "refuse") {
      console.warn(`[meeting-bot] La sala ${code} ya tiene un asistente de otra organización; no se une (reunión ${meetingId}).`);
      await prisma.meeting.update({ where: { id: meetingId }, data: { botStatus: "FAILED" } });
      return;
    }
    sessionId = decision.sessionId;
  } else if (!response.ok) {
    throw new Error(`El servicio del bot respondió ${response.status} al pedirle que se una.`);
  } else {
    sessionId = parseSessionId(await response.json().catch(() => null));
    if (sessionId === null) {
      // Versión de Vexa que no devuelve el id al crear: se busca la sesión recién creada para esta sala.
      sessionId = pickSession(await listSessions(), { sessionId: null, nativeId: code, sinceMs: requestedAt - 60_000 })?.id ?? null;
    }
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      vexaSessionId: sessionId,
      // Al adoptar la sesión de otra reunión de la misma organización no se pisa un estado más avanzado.
      ...(response.status === 409 ? {} : { botStatus: "JOINING" as const }),
    },
  });
  if (response.status === 409) {
    await prisma.meeting.updateMany({ where: { id: meetingId, OR: [{ botStatus: null }, { botStatus: "PENDING" }] }, data: { botStatus: "JOINING" } });
  }

  await enqueueOrReschedule({
    type: "vexa_bot_poll",
    uniqueKey: `vexa-poll-${meetingId}`,
    payload: { meetingId, nativeMeetingId: code, startedAt: new Date().toISOString(), vexaSessionId: sessionId ?? undefined },
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
