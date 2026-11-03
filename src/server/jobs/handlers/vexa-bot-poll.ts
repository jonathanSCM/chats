import { z } from "zod";
import { prisma } from "@/server/db/client";
import { saveMediaFile } from "@/lib/media-storage";
import { enqueue, enqueueOrReschedule } from "../queue";
import { NON_TERMINAL_STATUSES, describeJoinFailure, pickSession, shouldRetryJoin, type VexaSessionEntry } from "@/lib/vexa-session";
import { billableMinutes, creditsForAudio } from "@/lib/ai-credits";
import { chargeCredits } from "@/server/services/ai/credits";

export const vexaBotPollPayload = z.object({
  meetingId: z.string(),
  nativeMeetingId: z.string(),
  startedAt: z.string(),
  // Id de la sesión del bot en Vexa. Los jobs que ya estaban en cola antes de este cambio no lo traen:
  // se buscan por el código de la sala y se les guarda el id apenas se encuentra la sesión.
  vexaSessionId: z.number().int().optional(),
  // Reintentos de entrada ya hechos (los jobs anteriores a este cambio no lo traen: se cuentan como 0).
  joinAttempt: z.number().int().min(0).optional(),
});

// Estados terminales: ver NON_TERMINAL_STATUSES en lib/vexa-session -- cualquier otro valor
// se trata como terminal (la reunión ya se cortó, sea con éxito o con error).

// Si Vexa nunca llega a un estado terminal en este lapso, se da por perdido
// en vez de seguir encolando para siempre (una reunión real no dura tanto).
const MAX_POLL_MS = 4 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 15_000;

function vexaConfig(): { url: string; apiKey: string } | null {
  const url = process.env.VEXA_API_URL;
  const apiKey = process.env.VEXA_API_KEY;
  if (!url || !apiKey) return null;
  return { url, apiKey };
}

interface VexaRecording {
  id: number;
  playback_url?: { audio?: string | null };
}

interface VexaTranscriptSegment {
  speaker?: string | null;
  text: string;
}

interface VexaTranscriptResponse {
  segments?: VexaTranscriptSegment[];
  recordings?: VexaRecording[];
}

/**
 * Sigue el progreso de un bot de Vexa hasta que la reunión termina (con éxito
 * o con error), y ahí cierra el ciclo -- reemplaza al webhook que usaba el
 * bot casero (`meeting-bot/`), porque Vexa no empuja avisos, hay que
 * preguntarle. Mientras la reunión sigue activa, se reprograma a sí mismo
 * cada `POLL_INTERVAL_MS` en vez de bloquear un worker esperando.
 */
export async function handleVexaBotPoll(rawPayload: unknown): Promise<void> {
  const { meetingId, nativeMeetingId, startedAt, vexaSessionId: payloadSessionId, joinAttempt = 0 } = vexaBotPollPayload.parse(rawPayload);

  const config = vexaConfig();
  if (!config) {
    console.warn("[vexa-bot-poll] VEXA_API_URL/VEXA_API_KEY no configurados — se omite el job.");
    return;
  }

  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (elapsedMs > MAX_POLL_MS) {
    await prisma.meeting.update({ where: { id: meetingId }, data: { botStatus: "FAILED" } });
    return;
  }

  const listResponse = await fetch(`${config.url}/bots`, {
    headers: { "X-API-Key": config.apiKey },
  });
  if (!listResponse.ok) {
    throw new Error(`Vexa respondió ${listResponse.status} al consultar el estado del bot.`);
  }
  const list = (await listResponse.json()) as { meetings?: VexaSessionEntry[] };

  // Se sigue la SESIÓN del bot (por su id), no la sala: una sala reutilizada tiene varias sesiones y la más
  // nueva no tiene por qué ser la de esta reunión.
  const stored = payloadSessionId
    ? null
    : await prisma.meeting.findUnique({ where: { id: meetingId }, select: { vexaSessionId: true } });
  let sessionId: number | null = payloadSessionId ?? stored?.vexaSessionId ?? null;
  const entry = pickSession(list.meetings ?? [], {
    sessionId,
    nativeId: nativeMeetingId,
    // Reuniones sin id guardado (iniciadas antes de este cambio): la sesión creada desde que se pidió el bot.
    sinceMs: new Date(startedAt).getTime() - 5 * 60_000,
  });
  if (entry && sessionId === null) {
    sessionId = entry.id;
    await prisma.meeting.update({ where: { id: meetingId }, data: { vexaSessionId: entry.id } });
  }
  const sessionIdForJobs = sessionId ?? undefined;

  if (!entry) {
    // Todavía no aparece en la lista (puede tardar un instante en registrarse) — reintentar.
    // Job nuevo, sin uniqueKey repetido: este mismo job (el que se está
    // corriendo ahora mismo) lo marca DONE `processJobs` apenas termina este
    // handler, así que reprogramarlo con la MISMA uniqueKey pisaría ese
    // vuelto-a-PENDING con el DONE de acá -- por eso cada vuelta es una fila
    // aparte en vez de reabrir la anterior.
    await enqueue({
      type: "vexa_bot_poll",
      payload: { meetingId, nativeMeetingId, startedAt, vexaSessionId: sessionIdForJobs, joinAttempt },
      runAfter: new Date(Date.now() + POLL_INTERVAL_MS),
    });
    return;
  }

  if (NON_TERMINAL_STATUSES.has(entry.status)) {
    if (entry.status === "active") {
      const current = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { botJoinedAt: true } });
      if (!current?.botJoinedAt) {
        await prisma.meeting.update({
          where: { id: meetingId },
          data: { botStatus: "RECORDING", botJoinedAt: new Date(), botFailureReason: null },
        });
      }
    } else if (entry.status === "awaiting_admission") {
      // Ya llegó a la sala de espera: se hace visible para que alguien lo admita (solo si seguía "entrando").
      await prisma.meeting.updateMany({
        where: { id: meetingId, botStatus: { in: ["PENDING", "JOINING"] } },
        data: { botStatus: "WAITING_ADMISSION" },
      });
    }
    await enqueue({
      type: "vexa_bot_poll",
      payload: { meetingId, nativeMeetingId, startedAt, vexaSessionId: sessionIdForJobs, joinAttempt },
      runAfter: new Date(Date.now() + POLL_INTERVAL_MS),
    });
    return;
  }

  // Falló al ENTRAR (nunca estuvo en la llamada): no hay nada que transcribir. Se reintenta si el motivo suele ser
  // pasajero; si no, queda FAILED con el motivo en palabras de una persona.
  if (entry.failure_stage === "joining" || entry.failure_stage === "awaiting_admission") {
    await handleJoinFailure(meetingId, entry, joinAttempt);
    return;
  }

  // Estado terminal -- se acabó, para bien o para mal. Se marca como
  // "transcribiendo" mientras se junta todo, igual que hacía el bot casero.
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { botStatus: "TRANSCRIBING", botLeftAt: new Date() },
  });

  // La transcripción y la grabación de ESTA sesión (por su id), no todo lo que haya pasado por la sala.
  const transcriptUrl =
    sessionId !== null
      ? `${config.url}/transcripts/by-id/${sessionId}`
      : `${config.url}/transcripts/google_meet/${nativeMeetingId}`;
  const transcriptResponse = await fetch(transcriptUrl, {
    headers: { "X-API-Key": config.apiKey },
  });
  const transcriptData = transcriptResponse.ok ? ((await transcriptResponse.json()) as VexaTranscriptResponse) : null;

  const transcript =
    transcriptData?.segments
      ?.filter((seg) => !isLikelyWhisperHallucination(seg.text))
      .map((seg) => `${seg.speaker?.trim() || "?"}: ${seg.text.trim()}`)
      .join("\n")
      .trim() || null;

  if (transcript) {
    // Va a `audioTranscript`, no a `transcript` -- ese campo queda
    // reservado para los subtítulos en vivo de Meet (los manda la extensión
    // por separado, ver api/extension/transcript, que SUMA a lo que ya
    // hubiera en vez de pisarlo). Si algún día corren los dos a la vez en la
    // misma reunión, se complementan en vez de que uno tape al otro -- el
    // mismo diseño de dos fuentes que ya tenía el bot casero.
    await saveAttachmentOnce(meetingId, "transcripcion-audio-whisper.txt", "text/plain", Buffer.from(transcript, "utf-8"));
  }

  // Los subtítulos en vivo de Meet (campo `transcript`, sumados durante la
  // reunión vía api/extension/transcript o el parche del bot) quedaban solo
  // en la base -- se usaban para el resumen en PDF, pero nadie podía verlos
  // ni bajarlos directo. Ahora, igual que con el de Whisper arriba, se
  // guardan como adjunto propio si hay algo que guardar.
  const meetingForCaptions = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { transcript: true },
  });
  if (meetingForCaptions?.transcript) {
    await saveAttachmentOnce(meetingId, "subtitulos-meet.txt", "text/plain", Buffer.from(meetingForCaptions.transcript, "utf-8"));
  }

  const recording = transcriptData?.recordings?.[transcriptData.recordings.length - 1];
  if (recording?.playback_url?.audio) {
    try {
      const masterResponse = await fetch(`${config.url}${recording.playback_url.audio}`, {
        headers: { "X-API-Key": config.apiKey },
      });
      const master = masterResponse.ok ? ((await masterResponse.json()) as { raw_url?: string }) : null;
      if (master?.raw_url) {
        const rawUrl = master.raw_url.startsWith("http") ? master.raw_url : `${config.url}${master.raw_url}`;
        const audioResponse = await fetch(rawUrl, { headers: { "X-API-Key": config.apiKey } });
        if (audioResponse.ok) {
          const buffer = Buffer.from(await audioResponse.arrayBuffer());
          const mimeType = audioResponse.headers.get("content-type") || "audio/webm";
          await saveAttachmentOnce(meetingId, "grabacion.webm", mimeType, buffer);
        }
      }
    } catch (error) {
      // Best-effort: si falla bajar el audio, se sube igual la transcripción
      // ya guardada arriba en vez de perder todo por esto.
      console.warn(`[vexa-bot-poll] No se pudo bajar la grabación de ${meetingId}:`, error);
    }
  }

  const failed = Boolean(entry.failure_stage) || entry.status === "failed" || entry.status === "error";
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { botStatus: failed ? "FAILED" : "DONE", audioTranscript: transcript },
  });

  if (!failed) await chargeTranscription(meetingId);
}

/**
 * Guarda un adjunto de la reunión solo si todavía no está: si el job se repite (falló a mitad de camino), no deja
 * copias duplicadas de la transcripción, los subtítulos ni el audio.
 */
async function saveAttachmentOnce(meetingId: string, fileName: string, mimeType: string, content: Buffer): Promise<void> {
  const existing = await prisma.meetingAttachment.findFirst({ where: { meetingId, fileName }, select: { id: true } });
  if (existing) return;
  const url = await saveMediaFile(content, mimeType);
  await prisma.meetingAttachment.create({ data: { meetingId, url, fileName, mimeType, fileSize: content.byteLength } });
}

/** El asistente no llegó a entrar. Reintenta si corresponde (ver shouldRetryJoin); si no, deja el motivo a la vista. */
async function handleJoinFailure(meetingId: string, entry: VexaSessionEntry, attempt: number): Promise<void> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { status: true, botStatus: true, botFailureReason: true, createdAt: true, scheduledAt: true, durationMinutes: true, meetingUrl: true },
  });
  const endsAt = meeting ? meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000 : 0;
  // Si una captura ya mostró por qué (p. ej. Meet lo mandó a su página de inicio), ese motivo vale más que el de Vexa
  // y no se reintenta: el link no abre una reunión en curso.
  const knownReason = meeting?.botFailureReason ?? null;
  const retry =
    knownReason === null &&
    Boolean(meeting?.meetingUrl) &&
    meeting?.status !== "CANCELED" &&
    meeting?.botStatus !== null && // si alguien lo canceló a mano, el estado ya no es de un bot pedido
    shouldRetryJoin({
      entry,
      attempt,
      // Agendada con tiempo (no "Unir ya"): el anfitrión suele llegar tarde, vale la pena volver a golpear la puerta.
      scheduledInAdvance: meeting ? meeting.scheduledAt.getTime() - meeting.createdAt.getTime() > 2 * 60_000 : false,
      meetingEnded: Date.now() > endsAt,
    });

  if (retry) {
    console.warn(`[vexa-bot-poll] La reunión ${meetingId} no pudo entrar (${entry.data?.join_evidence?.reason ?? entry.failure_stage}); reintento ${attempt + 1}.`);
    await prisma.meeting.update({ where: { id: meetingId }, data: { botStatus: "PENDING" } });
    await enqueueOrReschedule({
      type: "meeting_bot_join",
      uniqueKey: `meeting-bot-${meetingId}`,
      payload: { meetingId, attempt: attempt + 1 },
      runAfter: new Date(Date.now() + 20_000),
    });
    return;
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { botStatus: "FAILED", botLeftAt: new Date(), botFailureReason: knownReason ?? describeJoinFailure(entry) },
  });
}

/**
 * Cobra la transcripción de la reunión a la bolsa de créditos de IA (5 créditos por minuto en la llamada).
 * Solo si la organización usa créditos; y una sola vez por reunión, aunque el job se repita.
 */
async function chargeTranscription(meetingId: string): Promise<void> {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { organizationId: true, botJoinedAt: true, botLeftAt: true },
    });
    if (!meeting?.botJoinedAt || !meeting.botLeftAt) return;
    const minutes = billableMinutes(meeting.botJoinedAt, meeting.botLeftAt);
    if (minutes <= 0) return;
    const already = await prisma.aiCreditUsage.findFirst({
      where: { organizationId: meeting.organizationId, feature: "transcripcion", entityId: meetingId },
      select: { id: true },
    });
    if (already) return;
    await chargeCredits({
      organizationId: meeting.organizationId,
      feature: "transcripcion",
      credits: creditsForAudio(minutes),
      audioMinutes: minutes,
      entityId: meetingId,
    });
  } catch (error) {
    // La reunión ya quedó guardada: un fallo al anotar los créditos no debe volver a correr todo el job.
    console.error(`[vexa-bot-poll] No se pudieron cobrar los créditos de la reunión ${meetingId}:`, error);
  }
}

// Frases que Whisper "inventa" con frecuencia documentada cuando le llega un
// tramo de audio silencioso o con ruido de fondo -- las aprendió de su
// entrenamiento con subtítulos de YouTube, no las dijo nadie en la reunión.
// Filtrarlas de raíz es mejor que dejarlas y que parezca que alguien las dijo.
const WHISPER_HALLUCINATION_PATTERNS = [
  /subt[ií]tulos (realizados |hechos )?por la comunidad de amara\.org/i,
  /subt[ií]tulos por la comunidad de amara\.org/i,
  /m[aá]s informaci[oó]n (en )?www\./i,
  /suscr[ií]bete/i,
  /gracias por ver( el video)?/i,
  /cc por antarctica films argentina/i,
];

function isLikelyWhisperHallucination(text: string): boolean {
  const trimmed = text.trim();
  return WHISPER_HALLUCINATION_PATTERNS.some((re) => re.test(trimmed));
}

/** Se agotaron los reintentos del polling (errores repetidos de red/API) — queda visible como fallido. */
export async function markVexaBotPollFailed(rawPayload: unknown): Promise<void> {
  const parsed = vexaBotPollPayload.safeParse(rawPayload);
  if (!parsed.success) return;

  await prisma.meeting.updateMany({
    where: { id: parsed.data.meetingId },
    data: { botStatus: "FAILED" },
  });
}
