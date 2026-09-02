import express from "express";
import { timingSafeEqual } from "node:crypto";
import { joinAndRecord } from "./join-meeting";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

const app = express();
app.use(express.json());

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

  res.status(202).json({ ok: true });

  void joinAndRecord({
    meetingId,
    meetingUrl,
    expectedDurationMinutes: typeof expectedDurationMinutes === "number" ? expectedDurationMinutes : 30,
    callbackUrl,
  }).catch((error) => {
    console.error(`[meeting-bot] Fallo no controlado en la reunión ${meetingId}:`, error);
  });
});

app.listen(PORT, () => {
  console.log(`[meeting-bot] escuchando en el puerto ${PORT}`);
});
