import { spawn } from "node:child_process";

// Tipos de audio que la Cloud API de WhatsApp acepta tal cual.
// Chrome graba en audio/webm, que NO está en la lista — por eso hay que
// transcodificar las notas de voz antes de mandarlas.
const WHATSAPP_AUDIO_TYPES = [
  "audio/aac",
  "audio/mp4",
  "audio/mpeg",
  "audio/amr",
  "audio/ogg",
];

export function isWhatsAppAudioType(mimeType: string): boolean {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return WHATSAPP_AUDIO_TYPES.includes(base);
}

// Convierte cualquier audio a ogg/opus (el formato de las notas de voz de
// WhatsApp) usando ffmpeg por stdin/stdout, sin tocar el disco.
export function transcodeToOpus(input: Buffer): Promise<Buffer<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-vn",
      "-c:a", "libopus",
      "-b:a", "32k",
      "-ar", "48000",
      "-ac", "1",
      "-f", "ogg",
      "pipe:1",
    ]);

    const chunks: Buffer<ArrayBuffer>[] = [];
    let stderr = "";

    ffmpeg.stdout.on("data", (chunk: Buffer<ArrayBuffer>) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", (error) => {
      reject(
        new Error(
          `No se pudo ejecutar ffmpeg (¿está instalado en el contenedor?): ${error.message}`,
        ),
      );
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg falló (código ${code}): ${stderr}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    ffmpeg.stdin.on("error", () => {
      // ffmpeg puede cerrar stdin antes de tiempo si el input es inválido;
      // el error real se reporta en el evento "close".
    });
    ffmpeg.stdin.end(input);
  });
}
