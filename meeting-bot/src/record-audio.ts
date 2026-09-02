import { spawn } from "node:child_process";
import path from "node:path";

const OUTPUT_DIR = process.env.RECORDINGS_DIR || "/tmp/recordings";
// El "monitor" de un sink de PulseAudio es su fuente espejo — grabarlo
// captura todo lo que suena por ese sink (o sea, el audio de la reunión que
// Chromium reproduce ahí). El sink se crea en entrypoint.sh al arrancar el
// contenedor.
const PULSE_SOURCE = process.env.PULSE_MONITOR_SOURCE || "virtual_sink.monitor";

export interface Recording {
  filePath: string;
  stop: () => Promise<void>;
}

/**
 * Arranca ffmpeg grabando el sink virtual de audio a un mp3. `stop()` le
 * pide un corte prolijo (comando "q" por stdin, como en una sesión
 * interactiva de ffmpeg) para que el archivo quede bien cerrado en vez de
 * truncado a la mitad.
 */
export async function startRecording(meetingId: string): Promise<Recording> {
  const filePath = path.join(OUTPUT_DIR, `${meetingId}.mp3`);

  const ffmpeg = spawn("ffmpeg", ["-y", "-f", "pulse", "-i", PULSE_SOURCE, "-ac", "1", "-b:a", "64k", filePath]);

  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    // ffmpeg manda su progreso normal a stderr aunque no haya error — solo
    // se loguea si hace falta debuggear a mano, no en cada línea.
    if (process.env.FFMPEG_DEBUG === "true") console.error(chunk.toString());
  });

  // Diagnóstico: si el audio graba en silencio, esto dice de una vez si el
  // problema es que Chromium nunca conectó su audio al sink (0 sink-inputs
  // — la reunión no está "sonando" ahí) o si el sink está mudo/en volumen 0
  // (hay un sink-input pero el volumen da 0%) — dos causas con arreglos
  // distintos. Se corre una sola vez, unos segundos después de arrancar,
  // para darle tiempo a Chromium a conectar el audio.
  setTimeout(() => {
    const check = spawn("sh", ["-c", "pactl list short sink-inputs && pactl get-sink-volume virtual_sink"]);
    let output = "";
    check.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    check.on("close", () => console.log(`[meeting-bot] Diagnóstico de audio:\n${output || "(sin salida)"}`));
  }, 8_000);

  const exitPromise = new Promise<void>((resolve) => ffmpeg.once("close", () => resolve()));

  const stop = async (): Promise<void> => {
    if (ffmpeg.exitCode !== null) return;
    ffmpeg.stdin.write("q");
    ffmpeg.stdin.end();
    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) =>
        setTimeout(() => {
          if (ffmpeg.exitCode === null) ffmpeg.kill("SIGTERM");
          resolve();
        }, 5_000),
      ),
    ]);
  };

  return { filePath, stop };
}
