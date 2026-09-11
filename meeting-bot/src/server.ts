import express from "express";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { joinAndRecord } from "./join-meeting";
import { transcribeAudioFile } from "./transcribe-audio";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

const app = express();
app.use(express.json());

// Una reunión a la vez por meetingId — se usa tanto para no duplicar un
// /join repetido como para poder encontrar el AbortController correcto
// cuando llega un /stop.
const activeSessions = new Map<string, AbortController>();

function isAuthorized(authHeader: string | undefined): boolean {
  const secret = process.env.BOT_SERVICE_SECRET;
  if (!secret) return false;

  const provided = (authHeader || "").replace("Bearer ", "");
  const expectedBuf = Buffer.from(secret);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Único endpoint real: le dice al bot que entre a una reunión. Responde 202
// al toque (la reunión puede durar horas) — el resultado real (grabación
// subida, o fallo) llega después al `callbackUrl` que manda la app
// principal, no en esta respuesta.
app.post("/join", (req, res) => {
  if (!isAuthorized(req.headers.authorization)) {
    res.status(401).send("Unauthorized");
    return;
  }

  const { meetingId, meetingUrl, expectedDurationMinutes, callbackUrl } = req.body ?? {};
  if (typeof meetingId !== "string" || typeof meetingUrl !== "string" || typeof callbackUrl !== "string") {
    res.status(400).send("Faltan meetingId/meetingUrl/callbackUrl");
    return;
  }

  if (activeSessions.has(meetingId)) {
    res.status(409).json({ ok: false, error: "Ya hay una sesión activa para esta reunión" });
    return;
  }

  res.status(202).json({ ok: true });

  const controller = new AbortController();
  activeSessions.set(meetingId, controller);

  void joinAndRecord(
    {
      meetingId,
      meetingUrl,
      expectedDurationMinutes: typeof expectedDurationMinutes === "number" ? expectedDurationMinutes : 30,
      callbackUrl,
    },
    controller.signal,
  )
    .catch((error) => {
      console.error(`[meeting-bot] Fallo no controlado en la reunión ${meetingId}:`, error);
    })
    .finally(() => {
      activeSessions.delete(meetingId);
    });
});

// Corta a mano una reunión que el bot está manejando ahora mismo — "salir
// de la reunión" desde el panel de la app principal, en vez de esperar a
// que se quede solo o se cumpla la duración esperada.
app.post("/stop", (req, res) => {
  if (!isAuthorized(req.headers.authorization)) {
    console.warn("[meeting-bot] POST /stop con auth inválida");
    res.status(401).send("Unauthorized");
    return;
  }

  const { meetingId } = req.body ?? {};
  if (typeof meetingId !== "string") {
    res.status(400).send("Falta meetingId");
    return;
  }

  console.log(`[meeting-bot] POST /stop para ${meetingId} — sesiones activas: [${[...activeSessions.keys()].join(", ")}]`);

  const controller = activeSessions.get(meetingId);
  if (!controller) {
    console.warn(`[meeting-bot] /stop: no hay sesión activa para ${meetingId}`);
    res.status(404).json({ ok: false, error: "No hay una sesión activa para esa reunión" });
    return;
  }

  controller.abort();
  console.log(`[meeting-bot] /stop: se pidió cortar ${meetingId} — puede tardar hasta 30s en notarlo si ya estaba grabando.`);
  res.json({ ok: true });
});

// Transcribe un archivo de audio suelto con whisper.cpp -- lo usa la app
// principal para el audio que sube la extensión de subtítulos de Meet
// (grabado en el navegador con tabCapture + micrófono, no por este bot).
// Sin bot de por medio: solo reutiliza el mismo whisper.cpp que ya vive acá,
// para no duplicar el binario ni el modelo en la imagen de la app principal.
// Body: audio crudo (cualquier formato que entienda ffmpeg), sin multipart.
app.post("/transcribe", express.raw({ type: "*/*", limit: "100mb" }), async (req, res) => {
  if (!isAuthorized(req.headers.authorization)) {
    res.status(401).send("Unauthorized");
    return;
  }

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).send("Falta el audio en el body");
    return;
  }

  const tmpDir = process.env.RECORDINGS_DIR || "/tmp/recordings";
  await mkdir(tmpDir, { recursive: true });
  const inputPath = path.join(tmpDir, `${randomUUID()}.audio`);

  try {
    await writeFile(inputPath, req.body);
    const transcript = await transcribeAudioFile(inputPath);
    res.json({ ok: true, transcript });
  } catch (error) {
    console.error("[meeting-bot] /transcribe falló:", error);
    res.status(500).json({ ok: false, error: String(error) });
  } finally {
    await rm(inputPath, { force: true }).catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`[meeting-bot] escuchando en el puerto ${PORT}`);
});
