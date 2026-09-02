import { chromium, type Page } from "playwright";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { startRecording } from "./record-audio";
import { uploadRecording, notifyFailure, notifyRecording } from "./upload-recording";
import { enableCaptions, startCapturingCaptions, type CaptionsCapture } from "./captions";

const PROFILE_DIR = process.env.CHROME_PROFILE_DIR || "/data/chrome-profile";
// Capturas en los pasos clave — los selectores de Meet son lo más frágil de
// todo esto, y sin ver la pantalla real es adivinar a ciegas por qué no
// encontró un botón. Se guardan en el disco del contenedor (no persistente),
// alcanza con sacarlas por `docker cp` mientras el contenedor sigue vivo.
const DEBUG_DIR = path.join(process.env.RECORDINGS_DIR || "/tmp/recordings", "debug");
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
 *
 * `signal` permite cortar a mano desde `POST /stop` (server.ts la aborta) —
 * si ya estaba grabando, corta prolijo y sube lo que se grabó hasta ese
 * momento, igual que si detectara que la reunión terminó sola.
 */
export async function joinAndRecord(options: JoinOptions, signal: AbortSignal): Promise<void> {
  const { meetingId, meetingUrl, expectedDurationMinutes, callbackUrl } = options;

  // Perfil persistente: ya tiene la sesión de la cuenta del bot logueada
  // (ver README — "Primer login" — se hace una sola vez a mano con
  // `npm run login`). Sin esto, cada reunión pediría loguearse de cero.
  //
  // Si esto falla (ej. el perfil sigue "en uso" porque una reunión anterior
  // no lo soltó a tiempo — un solo perfil no admite dos instancias de Chrome
  // al mismo tiempo), hay que avisarle a la app principal: si no, el error
  // queda solo en este log y `botStatus` se pega en "JOINING" para siempre.
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false, // corre bajo Xvfb (pantalla virtual, ver entrypoint.sh) — no hay pantalla física, pero Meet bloquea el modo headless "de verdad"
      args: ["--use-fake-ui-for-media-stream", "--disable-blink-features=AutomationControlled"],
      permissions: ["camera", "microphone"],
    });
  } catch (error) {
    await notifyFailure(callbackUrl, meetingId, `No se pudo abrir el navegador: ${error}`);
    return;
  }

  let recordingPath: string | null = null;
  let stopRecordingFn: (() => Promise<void>) | null = null;
  let captions: CaptionsCapture | null = null;
  let page: Page | undefined;

  try {
    page = await context.newPage();
    await page.goto(meetingUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await debugScreenshot(page, meetingId, "01-cargada");

    await joinMeeting(page, signal);
    await debugScreenshot(page, meetingId, "02-despues-de-unirse");

    await sendAnnouncement(page);

    if (await enableCaptions(page)) {
      captions = startCapturingCaptions(page);
    }

    const recording = await startRecording(meetingId);
    recordingPath = recording.filePath;
    stopRecordingFn = recording.stop;
    void notifyRecording(callbackUrl, meetingId);

    await waitForMeetingEnd(page, expectedDurationMinutes, signal);
  } catch (error) {
    if (page) await debugScreenshot(page, meetingId, "03-error");
    if (stopRecordingFn) await stopRecordingFn().catch(() => {});
    await context.close().catch(() => {});
    await notifyFailure(callbackUrl, meetingId, error instanceof Error ? error.message : String(error));
    return;
  }

  const captionsTranscript = captions?.stop() ?? "";
  if (stopRecordingFn) await stopRecordingFn();
  await context.close().catch(() => {});

  try {
    await uploadRecording(callbackUrl, meetingId, recordingPath, captionsTranscript);
  } catch (error) {
    await notifyFailure(callbackUrl, meetingId, `No se pudo subir la grabación: ${error}`);
  }
}

/**
 * En la práctica, Google trata a un navegador controlado por automatización
 * como invitado sin sesión aunque el perfil tenga cookies válidas (aparece
 * "Acceder" arriba a la derecha en vez de la cuenta) — el flujo real es el
 * de invitado: pide un nombre y el botón dice "Solicitar unirse", no
 * "Unirse ahora". Es la fricción de admisión manual que ya se aceptó como
 * aceptable (alguien admite al bot a mano, como a cualquier invitado nuevo).
 */
async function joinMeeting(page: Page, signal: AbortSignal): Promise<void> {
  // El botón de unirse queda deshabilitado hasta completar el nombre — con
  // `isVisible()` (que no espera, solo mira el estado actual) el campo podía
  // no existir todavía si la página seguía en "Preparando la llamada..."; con
  // `waitFor` se espera de verdad a que aparezca antes de decidir si hay que
  // completarlo o no.
  const nameInput = page.getByRole("textbox", { name: /tu nombre|your name/i });
  try {
    await nameInput.waitFor({ state: "visible", timeout: 15_000 });
    await nameInput.fill("Bot ProShop (grabando)");
  } catch {
    // No pidió nombre — probablemente ya hay una sesión reconocida y entra directo.
  }

  const joinButton = page.getByRole("button", {
    name: /unirse ahora|ask to join|join now|participar|solicitar unirse|pedir unirse|ask to be let in/i,
  });
  try {
    await joinButton.click({ timeout: 30_000 });
    console.log(`[meeting-bot] Encontró y clickeó el botón de unirse (url: ${page.url()})`);
  } catch {
    // Sin botón visible: puede que ya haya entrado directo, o que el
    // selector no matchee el texto/idioma real del botón — ver la captura
    // "02-despues-de-unirse" para diferenciar un caso del otro.
    console.warn(`[meeting-bot] No encontró el botón de unirse (url: ${page.url()})`);
    return;
  }

  await waitForAdmission(page, signal);
}

/**
 * Si entró pidiendo permiso ("Solicitar unirse"), queda en una sala de
 * espera hasta que alguien de la reunión lo admita — hasta 5 minutos. Si
 * nadie lo admite, tira un error a propósito (en vez de seguir el flujo
 * igual): sin esto, seguía adelante grabando ~45 minutos de nada, y el
 * navegador quedaba abierto todo ese tiempo bloqueando el perfil para la
 * próxima reunión que quisiera usarlo. También corta si alguien pide
 * `/stop` mientras todavía está esperando que lo admitan.
 */
async function waitForAdmission(page: Page, signal: AbortSignal): Promise<void> {
  const inCallIndicator = page.getByRole("button", { name: /personas|people/i }).first();
  await Promise.race([
    inCallIndicator.waitFor({ timeout: 5 * 60_000 }),
    abortPromise(signal, "Se pidió detener el bot mientras esperaba que lo admitieran."),
  ]);
  console.log("[meeting-bot] Ya está adentro de la reunión.");
}

function abortPromise(signal: AbortSignal, message: string): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error(message));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error(message)), { once: true });
  });
}

async function debugScreenshot(page: Page, meetingId: string, step: string): Promise<void> {
  try {
    await mkdir(DEBUG_DIR, { recursive: true });
    const file = path.join(DEBUG_DIR, `${meetingId}-${step}.png`);
    await page.screenshot({ path: file });
    console.log(`[meeting-bot] Captura: ${file} (url: ${page.url()})`);
  } catch (error) {
    console.warn("[meeting-bot] No se pudo guardar la captura de debug:", error);
  }
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

/**
 * Corta cuando pasa lo que sea primero: se queda solo en la llamada, se
 * cumple la duración esperada + margen, o alguien pide `/stop` a mano
 * (`signal`). En los tres casos es una salida "normal" — se sube igual lo
 * que se grabó hasta ese momento, no se trata como un fallo.
 */
async function waitForMeetingEnd(page: Page, expectedDurationMinutes: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + (expectedDurationMinutes + END_BUFFER_MINUTES) * 60_000;

  while (Date.now() < deadline) {
    if (signal.aborted) return;
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
