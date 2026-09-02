import { readFile } from "node:fs/promises";

/**
 * Sube la grabación a la app principal. Mismo secreto que valida
 * `api/webhooks/meeting-bot` del lado de la app — sin él, el webhook
 * responde 401 y el intento se pierde (no hay reintento propio acá, el bot
 * ya hizo su parte; ver nota en `notifyFailure`).
 */
export async function uploadRecording(
  callbackUrl: string,
  meetingId: string,
  filePath: string,
  captionsTranscript: string,
  audioTranscript: string,
): Promise<void> {
  const buffer = await readFile(filePath);
  const form = new FormData();
  form.append("meetingId", meetingId);
  form.append("audio", new Blob([buffer], { type: "audio/mpeg" }), `${meetingId}.mp3`);
  if (captionsTranscript) form.append("captionsTranscript", captionsTranscript);
  if (audioTranscript) form.append("audioTranscript", audioTranscript);

  const response = await fetch(callbackUrl, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });

  if (!response.ok) {
    throw new Error(`El callback de la app principal respondió ${response.status}`);
  }
}

/**
 * Avisa que el bot ya está adentro de la reunión y arrancó a grabar de
 * verdad — sin esto, el estado se quedaba pegado en "entrando" (JOINING)
 * durante toda la reunión, sin ninguna señal de que efectivamente estaba
 * grabando. Best-effort: si falla, no es grave — es solo un dato visual,
 * no afecta la grabación en sí.
 */
export async function notifyRecording(callbackUrl: string, meetingId: string): Promise<void> {
  try {
    const form = new FormData();
    form.append("meetingId", meetingId);
    form.append("status", "recording");
    await fetch(callbackUrl, { method: "POST", headers: authHeaders(), body: form });
  } catch (error) {
    console.warn(`[meeting-bot] No se pudo avisar que ${meetingId} empezó a grabar:`, error);
  }
}

/**
 * Avisa que la reunión falló (no se pudo entrar, grabar, etc.) para que la
 * app principal no deje la reunión colgada en "JOINING" para siempre. Es
 * best-effort: si esto también falla, no hay más reintentos de este lado —
 * la reunión queda visible como atascada hasta que alguien la revise a mano.
 */
export async function notifyFailure(callbackUrl: string, meetingId: string, reason: string): Promise<void> {
  console.error(`[meeting-bot] ${meetingId} falló: ${reason}`);
  try {
    const form = new FormData();
    form.append("meetingId", meetingId);
    form.append("status", "failed");
    form.append("error", reason);
    await fetch(callbackUrl, { method: "POST", headers: authHeaders(), body: form });
  } catch (error) {
    console.error(`[meeting-bot] No se pudo avisar el fallo de ${meetingId} a la app principal:`, error);
  }
}

function authHeaders(): Record<string, string> {
  const secret = process.env.MEETING_BOT_WEBHOOK_SECRET;
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}
