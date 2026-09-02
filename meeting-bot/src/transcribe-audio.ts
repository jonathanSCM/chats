import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";

const WHISPER_CPP_BIN = process.env.WHISPER_CPP_BIN || "/usr/local/bin/whisper-cli";
const WHISPER_MODEL_PATH = process.env.WHISPER_MODEL_PATH || "/opt/whisper-model/ggml-base.bin";

/**
 * Transcribe el audio grabado con whisper.cpp -- local y gratis, reemplaza
 * la llamada paga a la API de Whisper de OpenAI que se usaba antes. No
 * distingue quién habló (para eso están los subtítulos en vivo, ver
 * captions.ts) -- esto es el complemento: el texto completo de todo el
 * audio, sin huecos, para cuando los subtítulos fallaron o se perdieron
 * algún tramo.
 */
export async function transcribeWithWhisperCpp(mp3Path: string): Promise<string> {
  const wavPath = mp3Path.replace(/\.mp3$/, ".wav");
  await convertToWav(mp3Path, wavPath);

  try {
    return (await runWhisperCpp(wavPath)).trim();
  } finally {
    await unlink(wavPath).catch(() => {});
  }
}

// whisper.cpp espera WAV PCM 16kHz mono -- el audio se graba en mp3 (ver
// record-audio.ts), así que hace falta este paso intermedio.
function convertToWav(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output]);
    let stderr = "";
    ffmpeg.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg (mp3→wav) salió con código ${code}: ${stderr.slice(-500)}`));
    });
  });
}

function runWhisperCpp(wavPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputBase = wavPath.replace(/\.wav$/, "");
    // -otxt escribe `<outputBase>.txt` con la transcripción; -nt saca las
    // marcas de tiempo por línea, no hacen falta acá.
    const whisper = spawn(WHISPER_CPP_BIN, [
      "-m",
      WHISPER_MODEL_PATH,
      "-f",
      wavPath,
      "-l",
      "es",
      "-otxt",
      "-nt",
      "-of",
      outputBase,
    ]);
    let stderr = "";
    whisper.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    whisper.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`whisper.cpp salió con código ${code}: ${stderr.slice(-500)}`));
        return;
      }
      const txtPath = `${outputBase}.txt`;
      try {
        const text = await readFile(txtPath, "utf-8");
        await unlink(txtPath).catch(() => {});
        resolve(text);
      } catch (error) {
        reject(error);
      }
    });
  });
}
