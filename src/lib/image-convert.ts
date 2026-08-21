import { spawn } from "node:child_process";

// La Cloud API de WhatsApp rechaza WebP como imagen normal (error 131053,
// "WebP image uploads are not currently supported") — solo lo acepta para
// stickers, por un flujo aparte. Si el usuario adjunta un .webp (típico de
// capturas de pantalla o imágenes bajadas de la web), hay que convertirlo
// antes de mandarlo.
export function convertWebpToPng(input: Buffer): Promise<Buffer<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-f", "image2",
      "-c:v", "png",
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
