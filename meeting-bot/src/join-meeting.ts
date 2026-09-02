import { chromium, type Page } from "playwright";
import { startRecording } from "./record-audio";
import { uploadRecording, notifyFailure } from "./upload-recording";

const PROFILE_DIR = process.env.CHROME_PROFILE_DIR || "/data/chrome-profile";
// Cada cuánto se fija si quedó solo en la reunión.
const END_CHECK_INTERVAL_MS = 30_000;
// Margen sobre la duración esperada antes de cortar por las dudas, aunque
// el conteo de participantes no haya detectado que la reunión terminó.
const END_BUFFER_MINUTES = 15;

export interface JoinOptions {
  meetingId: string;
  meetingUrl: string;
  expectedDurationMinutes: number;
  callbackUrl: string;
}

/**
 * Orquesta el ciclo completo de una reunión: entrar, avisar que se graba,
 * grabar, detectar el final, y subir el audio. Se llama fire-and-forget
 * desde `server.ts` — todo lo que pasa acá se reporta al `callbackUrl`, no
 * hay respuesta HTTP que esperar mientras la reunión sigue.
 */
export async function joinAndRecord(options: JoinOptions): Promise<void> {
  const { meetingId, meetingUrl, expectedDurationMinutes, callbackUrl } = options;

  // Perfil persistente: ya tiene la sesión de la cuenta del bot logueada
  // (ver README — "Primer login" — se hace una sola vez a mano con
  // `npm run login`). Sin esto, cada reunión pediría loguearse de cero.
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, // corre bajo Xvfb (pantalla virtual, ver entrypoint.sh) — no hay pantalla física, pero Meet bloquea el modo headless "de verdad"
    args: ["--use-fake-ui-for-media-stream", "--disable-blink-features=AutomationControlled"],
    permissions: ["camera", "microphone"],
  });

  let recordingPath: string | null = null;
  let stopRecordingFn: (() => Promise<void>) | null = null;

  try {
    const page = await context.newPage();
    await page.goto(meetingUrl, { waitUntil: "networkidle", timeout: 60_000 });

    await joinMeeting(page);
    await sendAnnouncement(page);

    const recording = await startRecording(meetingId);
    recordingPath = recording.filePath;
    stopRecordingFn = recording.stop;

    await waitForMeetingEnd(page, expectedDurationMinutes);
  } catch (error) {
    if (stopRecordingFn) await stopRecordingFn().catch(() => {});
    await context.close().catch(() => {});
    await notifyFailure(callbackUrl, meetingId, error instanceof Error ? error.message : String(error));
    return;
  }

  if (stopRecordingFn) await stopRecordingFn();
  await context.close().catch(() => {});

  try {
    await uploadRecording(callbackUrl, meetingId, recordingPath);
  } catch (error) {
    await notifyFailure(callbackUrl, meetingId, `No se pudo subir la grabación: ${error}`);
  }
}

/**
 * Como la cuenta del bot es la organizadora del evento (lo creó vía Calendar
 * API), Meet la deja entrar directo — nunca aparece la pantalla de "pedir
 * unirse" que sí ve un invitado común. El botón puede tardar en aparecer o
 * ya haber entrado solo; ambos casos se toleran.
 */
async function joinMeeting(page: Page): Promise<void> {
  const joinButton = page.getByRole("button", { name: /unirse ahora|ask to join|join now|participar/i });
  await joinButton.click({ timeout: 30_000 }).catch(() => {
    // Sin botón visible: probablemente ya entró directo.
  });
  await page.waitForTimeout(3_000);
}

async function sendAnnouncement(page: Page): Promise<void> {
  try {
    await page.getByRole("button", { name: /chat con todos|chat with everyone|mostrar chat/i }).click({ timeout: 10_000 });
    const input = page.getByRole("textbox", { name: /enviar un mensaje|send a message/i });
    await input.fill("Esta reunión se está grabando para transcripción interna.");
    await input.press("Enter");
  } catch (error) {
    // El selector del chat de Meet es justamente lo más frágil de toda esta
    // integración — cambia con cada rediseño de Google. Si falla, seguir
    // grabando igual es mejor que cortar toda la reunión por esto.
    console.warn("[meeting-bot] No se pudo mandar el aviso de grabación por el chat:", error);
  }
}

async function waitForMeetingEnd(page: Page, expectedDurationMinutes: number): Promise<void> {
  const deadline = Date.now() + (expectedDurationMinutes + END_BUFFER_MINUTES) * 60_000;

  while (Date.now() < deadline) {
    await page.waitForTimeout(END_CHECK_INTERVAL_MS);
    if (await isAlone(page)) return;
  }
}

/** true si el contador de participantes de Meet muestra 1 (solo el bot) o menos. */
async function isAlone(page: Page): Promise<boolean> {
  try {
    const text = await page.getByRole("button", { name: /personas|people/i }).first().innerText({ timeout: 5_000 });
    const match = text.match(/\d+/);
    return match ? Number(match[0]) <= 1 : false;
  } catch {
    return false;
  }
}
