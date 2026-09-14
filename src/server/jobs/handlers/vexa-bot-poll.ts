import { z } from "zod";
import { prisma } from "@/server/db/client";
import { saveMediaFile } from "@/lib/media-storage";
import { enqueue } from "../queue";

export const vexaBotPollPayload = z.object({
  meetingId: z.string(),
  nativeMeetingId: z.string(),
  startedAt: z.string(),
});

// Estados de Vexa mientras la reunión sigue en curso -- cualquier otro valor
// se trata como terminal (la reunión ya se cortó, sea con éxito o con error).
const NON_TERMINAL_STATUSES = new Set(["requested", "joining", "awaiting_admission", "active"]);

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

interface VexaBotEntry {
  status: string;
  failure_stage?: string | null;
  updated_at?: string;
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
  const { meetingId, nativeMeetingId, startedAt } = vexaBotPollPayload.parse(rawPayload);

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
  const list = (await listResponse.json()) as { meetings?: Array<VexaBotEntry & { native_meeting_id: string; platform: string }> };
  const entry = (list.meetings ?? [])
    .filter((m) => m.platform === "google_meet" && m.native_meeting_id === nativeMeetingId)
    .sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime())[0];

  if (!entry) {
    // Todavía no aparece en la lista (puede tardar un instante en registrarse) — reintentar.
    // Job nuevo, sin uniqueKey repetido: este mismo job (el que se está
    // corriendo ahora mismo) lo marca DONE `processJobs` apenas termina este
    // handler, así que reprogramarlo con la MISMA uniqueKey pisaría ese
    // vuelto-a-PENDING con el DONE de acá -- por eso cada vuelta es una fila
    // aparte en vez de reabrir la anterior.
    await enqueue({
      type: "vexa_bot_poll",
      payload: { meetingId, nativeMeetingId, startedAt },
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
          data: { botStatus: "RECORDING", botJoinedAt: new Date() },
        });
      }
    }
    await enqueue({
      type: "vexa_bot_poll",
      payload: { meetingId, nativeMeetingId, startedAt },
      runAfter: new Date(Date.now() + POLL_INTERVAL_MS),
    });
    return;
  }

  // Estado terminal -- se acabó, para bien o para mal. Se marca como
  // "transcribiendo" mientras se junta todo, igual que hacía el bot casero.
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { botStatus: "TRANSCRIBING", botLeftAt: new Date() },
  });

  const transcriptResponse = await fetch(`${config.url}/transcripts/google_meet/${nativeMeetingId}`, {
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
    const txtUrl = await saveMediaFile(Buffer.from(transcript, "utf-8"), "text/plain");
    await prisma.meetingAttachment.create({
      data: {
        meetingId,
        url: txtUrl,
        fileName: "transcripcion-audio-whisper.txt",
        mimeType: "text/plain",
        fileSize: Buffer.byteLength(transcript, "utf-8"),
      },
    });
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
          const url = await saveMediaFile(buffer, mimeType);
          await prisma.meetingAttachment.create({
            data: { meetingId, url, fileName: "grabacion.webm", mimeType, fileSize: buffer.byteLength },
          });
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
