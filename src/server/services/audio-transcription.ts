import { isLikelyWhisperHallucination } from "@/lib/whisper-filter";
import { transcribeAudioForOrg } from "@/server/services/ai/client";

/**
 * Transcribe el audio que graba la extensión / el userscript de Meet (voces de la reunión + micrófono propio) con el
 * Whisper de OpenAI, usando la clave de la organización (ai/client.ts decide cuál). Reemplaza al servicio whisper.cpp
 * del bot casero (BOT_SERVICE_URL), que ya no existe.
 *
 * OpenAI acepta hasta 25 MB por archivo: por eso quien graba manda el audio en partes de ~10 minutos y a baja calidad
 * de voz (una hora pesa ~11 MB).
 */

export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export type AudioTranscription = { ok: true; transcript: string } | { ok: false; error: string };

export async function transcribeAudio(organizationId: string, buffer: Buffer, mimeType: string): Promise<AudioTranscription> {
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, error: `El audio pesa ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB y el máximo es 24 MB.` };
  }
  try {
    const text = await transcribeAudioForOrg({
      organizationId,
      buffer,
      mimeType,
      model: process.env.AUDIO_TRANSCRIPTION_MODEL || undefined,
      language: process.env.AUDIO_TRANSCRIPTION_LANGUAGE || undefined,
    });
    // Un tramo en silencio (micrófono apagado y nadie hablando) suele devolver una frase inventada: no es una transcripción.
    return { ok: true, transcript: isLikelyWhisperHallucination(text) && text.length < 160 ? "" : text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo transcribir el audio." };
  }
}
