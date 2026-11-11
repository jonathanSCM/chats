import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ transcribe: vi.fn() }));
vi.mock("@/server/services/ai/client", () => ({ transcribeAudioForOrg: m.transcribe }));

import { MAX_AUDIO_BYTES, transcribeAudio } from "./audio-transcription";

const audio = Buffer.from("fake-webm-bytes");

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AUDIO_TRANSCRIPTION_MODEL;
  delete process.env.AUDIO_TRANSCRIPTION_LANGUAGE;
});

describe("transcribeAudio", () => {
  it("transcribe con la clave de la organización y devuelve el texto", async () => {
    m.transcribe.mockResolvedValue("Hola, buenas tardes.");
    await expect(transcribeAudio("org1", audio, "audio/webm")).resolves.toEqual({ ok: true, transcript: "Hola, buenas tardes." });
    expect(m.transcribe).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org1", mimeType: "audio/webm" }));
  });

  it("un tramo en silencio (frase inventada por Whisper) no cuenta como transcripción", async () => {
    m.transcribe.mockResolvedValue("Gracias por ver el video.");
    await expect(transcribeAudio("org1", audio, "audio/webm")).resolves.toEqual({ ok: true, transcript: "" });
  });

  it("una frase larga que menciona una de esas expresiones sí se conserva", async () => {
    const long = `Les cuento que ya puede suscribirse al plan mensual y que ${"hablamos de los precios ".repeat(10)}`.trim();
    m.transcribe.mockResolvedValue(long);
    await expect(transcribeAudio("org1", audio, "audio/webm")).resolves.toEqual({ ok: true, transcript: long });
  });

  it("un error (sin créditos, sin clave, OpenAI caído) se devuelve sin lanzar", async () => {
    m.transcribe.mockRejectedValue(new Error("Se acabaron los créditos"));
    const result = await transcribeAudio("org1", audio, "audio/webm");
    expect(result).toEqual({ ok: false, error: "Se acabaron los créditos" });
  });

  it("no llama a OpenAI si el audio pasa el límite de 25 MB", async () => {
    const result = await transcribeAudio("org1", Buffer.alloc(MAX_AUDIO_BYTES + 1), "audio/webm");
    expect(result.ok).toBe(false);
    expect(m.transcribe).not.toHaveBeenCalled();
  });
});
