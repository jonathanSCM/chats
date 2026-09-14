import { chromium, type Page } from "playwright";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { startRecording } from "./record-audio";
import { uploadRecording, notifyFailure, notifyRecording, notifyTranscribing } from "./upload-recording";
import { enableCaptions, startCapturingCaptions, type CaptionsCapture } from "./captions";
import { transcribeWithWhisperCpp } from "./transcribe-audio";

// Capturas y volcados de accesibilidad en los pasos clave — útiles mientras
// se ajustan los selectores de Meet (lo más frágil de todo esto), pero se
// acumulan en el disco del contenedor en cada reunión — apagados por
// default para no llenar el almacenamiento; se prenden puntualmente con
// MEETING_BOT_DEBUG=true si hay que volver a diagnosticar algo a ciegas.
const DEBUG_ENABLED = process.env.MEETING_BOT_DEBUG === "true";
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
  // Nombre con el que el bot se presenta al pedir unirse -- si no viene,
  // usa un genérico (ver DEFAULT_DISPLAY_NAME más abajo).
  displayName?: string;
}

const DEFAULT_DISPLAY_NAME = "Asistente ProShop (grabando)";

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
  const { meetingId, meetingUrl, expectedDurationMinutes, callbackUrl, displayName } = options;

  // Navegador nuevo y descartable para cada reunión, sin ningún perfil de
  // Chrome persistente ni sesión de Google logueada. Antes se mantenía un
  // perfil con una cuenta de Google logueada a propósito, pero en la
  // práctica Google trata a un navegador controlado por automatización como
  // invitado sin sesión de todas formas (ver el comentario en joinMeeting()
  // más abajo) -- el login no evitaba la fricción de "pedir unirse" que ya
  // se acepta como normal, solo agregaba mantenimiento (loguear la cuenta a
  // mano, guardarla en un volumen, el riesgo de que Google la banee) y un
  // problema real de producción: un perfil persistente lo bloquea Chrome
  // para UN solo proceso, así que si dos reuniones se solapaban, la segunda
  // fallaba de una con "Opening in existing browser session" y esa reunión
  // se perdía por completo sin grabar nada. Con un navegador nuevo por
  // reunión, ese problema desaparece solo -- no hay nada que compartir ni
  // que bloquear entre reuniones en paralelo.
  let browser;
  let context;
  try {
    browser = await chromium.launch({
      headless: false, // corre bajo Xvfb (pantalla virtual, ver entrypoint.sh) — no hay pantalla física, pero Meet bloquea el modo headless "de verdad"
      args: ["--use-fake-ui-for-media-stream", "--disable-blink-features=AutomationControlled"],
    });
    context = await browser.newContext({ permissions: ["camera", "microphone"] });
  } catch (error) {
    await browser?.close().catch(() => {});
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

    await joinMeeting(page, signal, displayName || DEFAULT_DISPLAY_NAME);
    await debugScreenshot(page, meetingId, "02-despues-de-unirse");

    await sendAnnouncement(page);

    if (await enableCaptions(page)) {
      captions = startCapturingCaptions(page, meetingId);
      // Espera un toque a que la barra de subtítulos termine de aparecer en
      // pantalla antes de sacar la foto — así la captura sirve para
      // confirmar (o descartar) que Meet los prendió de verdad, no solo que
      // se clickeó algo con el nombre correcto.
      await page.waitForTimeout(3_000);
      await debugScreenshot(page, meetingId, "03-subtitulos-activados");
      await debugAccessibilityDump(page, meetingId, "03-subtitulos-activados");
    }

    const recording = await startRecording(meetingId);
    recordingPath = recording.filePath;
    stopRecordingFn = recording.stop;
    void notifyRecording(callbackUrl, meetingId);

    await waitForMeetingEnd(page, expectedDurationMinutes, signal);
  } catch (error) {
    if (page) await debugScreenshot(page, meetingId, "03-error");
    if (stopRecordingFn) await stopRecordingFn().catch(() => {});
    await browser.close().catch(() => {});
    await notifyFailure(callbackUrl, meetingId, error instanceof Error ? error.message : String(error));
    return;
  }

  const captionsTranscript = captions?.stop() ?? "";
  if (stopRecordingFn) await stopRecordingFn();
  await browser.close().catch(() => {});

  // Complemento gratis y local a los subtítulos en vivo: cubre los huecos
  // que estos puedan tener (no se activaron a tiempo, Meet los perdió en
  // algún tramo). Best-effort -- si falla, se sube igual lo que sí se tiene
  // (audio + subtítulos), no se trata como un fallo de toda la reunión.
  void notifyTranscribing(callbackUrl, meetingId);
  let audioTranscript = "";
  try {
    audioTranscript = await transcribeWithWhisperCpp(recordingPath);
    console.log(`[meeting-bot] whisper.cpp transcribió ${audioTranscript.length} caracteres para ${meetingId}.`);
  } catch (error) {
    console.warn(`[meeting-bot] No se pudo transcribir el audio con whisper.cpp para ${meetingId}:`, error);
  }

  try {
    await uploadRecording(callbackUrl, meetingId, recordingPath, captionsTranscript, audioTranscript);
  } catch (error) {
    await notifyFailure(callbackUrl, meetingId, `No se pudo subir la grabación: ${error}`);
  }
}

/**
 * Google trata a un navegador controlado por automatización como invitado
 * sin sesión sin importar nada del perfil (aparece "Acceder" arriba a la
 * derecha en vez de una cuenta) — el flujo real es siempre el de invitado:
 * pide un nombre y el botón dice "Solicitar unirse", no "Unirse ahora". Es
 * la fricción de admisión manual que ya se acepta como normal (alguien
 * admite al bot a mano, como a cualquier invitado nuevo).
 */
async function joinMeeting(page: Page, signal: AbortSignal, displayName: string): Promise<void> {
  // El botón de unirse queda deshabilitado hasta completar el nombre — con
  // `isVisible()` (que no espera, solo mira el estado actual) el campo podía
  // no existir todavía si la página seguía en "Preparando la llamada..."; con
  // `waitFor` se espera de verdad a que aparezca antes de decidir si hay que
  // completarlo o no.
  const nameInput = page.getByRole("textbox", { name: /tu nombre|your name/i });
  try {
    await nameInput.waitFor({ state: "visible", timeout: 15_000 });
    await nameInput.fill(displayName);
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
 * espera hasta que alguien de la reunión lo admita — hasta 10 minutos (antes
 * eran 5; en reuniones ad-hoc donde el bot entra como invitado, 5 minutos se
 * quedaba corto varias veces en producción). Si nadie lo admite, tira un
 * error a propósito (en vez de seguir el flujo igual): sin esto, seguía
 * adelante grabando ~45 minutos de nada con el navegador abierto sin
 * necesidad. Cada reunión tiene su propio navegador aparte, así que esperar
 * más acá no bloquea a otras reuniones en paralelo — el límite de 10 minutos
 * es solo para no desperdiciar el intento si nadie lo va a admitir. También
 * corta si alguien pide `/stop` mientras todavía está esperando que lo
 * admitan.
 */
async function waitForAdmission(page: Page, signal: AbortSignal): Promise<void> {
  const inCallIndicator = page.getByRole("button", { name: /personas|people/i }).first();
  await Promise.race([
    inCallIndicator.waitFor({ timeout: 10 * 60_000 }),
    abortPromise(signal, "Se pidió detener el bot mientras esperaba que lo admitieran."),
    detectNavigatedAway(page),
    detectJoinRejected(page),
  ]);
  console.log("[meeting-bot] Ya está adentro de la reunión.");
}

/**
 * Distinto del caso de arriba: acá Meet NO navega a otro dominio, se queda
 * en la misma URL de la reunión pero muestra "No podés unirte a esta
 * videollamada" / "You can't join this video call" -- confirmado con una
 * captura real. Pasa cuando la reunión tiene la seguridad configurada para
 * rechazar de entrada a cualquier invitado anónimo (sin ofrecer siquiera la
 * sala de espera) -- es una configuración de Meet/Workspace de esa reunión
 * puntual, no algo que el bot pueda resolver solo.
 */
async function detectJoinRejected(page: Page): Promise<never> {
  await page.getByText(/no pod[eé]s unirte a esta videollamada|you can't join this video call/i).waitFor({
    timeout: 10 * 60_000,
  });
  throw new Error(
    "Meet rechazó de entrada al bot ('No podés unirte a esta videollamada') -- la reunión no deja pedir acceso a invitados anónimos. Hay que revisar la configuración de acceso de esa reunión/Workspace, esto no lo resuelve el bot.",
  );
}

/**
 * Mientras espera que lo admitan, Meet puede navegar la pestaña a otro lado
 * por su cuenta (link vencido, la reunión ya terminó, o Google detectó el
 * navegador automatizado y lo redirigió) -- confirmado con una captura real
 * en producción: la pestaña terminó en la página de marketing de Meet
 * (workspace.google.com), no en la llamada. Antes esto no se detectaba, así
 * que `waitForAdmission` se quedaba esperando el contador de "Personas" los
 * 10 minutos completos sin ninguna chance de encontrarlo, sin avisar el
 * motivo real. Se revisa la URL cada 2s -- en cuanto deja de estar en
 * meet.google.com, se corta con un error claro en vez de agotar el tiempo.
 */
async function detectNavigatedAway(page: Page): Promise<never> {
  for (;;) {
    await page.waitForTimeout(2_000);
    if (page.isClosed()) {
      throw new Error("La pestaña de la reunión se cerró mientras esperaba que lo admitieran.");
    }
    if (!page.url().startsWith("https://meet.google.com/")) {
      throw new Error(
        `Google sacó la pestaña de la reunión mientras esperaba que lo admitieran (terminó en ${page.url()}) -- probablemente el link venció, la reunión ya terminó, o Google marcó el navegador como automatizado.`,
      );
    }
  }
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
  if (!DEBUG_ENABLED) return;
  try {
    await mkdir(DEBUG_DIR, { recursive: true });
    const file = path.join(DEBUG_DIR, `${meetingId}-${step}.png`);
    await page.screenshot({ path: file });
    console.log(`[meeting-bot] Captura: ${file} (url: ${page.url()})`);
  } catch (error) {
    console.warn("[meeting-bot] No se pudo guardar la captura de debug:", error);
  }
}

/**
 * Vuelca todos los elementos con algún atributo de accesibilidad (role,
 * aria-label, aria-live) a un JSON — mucho más preciso que adivinar
 * selectores mirando una captura de pantalla. Playwright sacó su API de
 * accessibility tree hace un tiempo, así que se arma a mano con
 * `page.evaluate`. Se usa puntualmente para encontrar de una vez el
 * contenedor real de subtítulos, en vez de seguir probando a ciegas.
 */
async function debugAccessibilityDump(page: Page, meetingId: string, step: string): Promise<void> {
  if (!DEBUG_ENABLED) return;
  try {
    await mkdir(DEBUG_DIR, { recursive: true });
    const nodes = await page.evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll("[role], [aria-label], [aria-live], [jsname]"),
      ) as HTMLElement[];
      return elements.slice(0, 400).map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        ariaLabel: el.getAttribute("aria-label"),
        ariaLive: el.getAttribute("aria-live"),
        jsname: el.getAttribute("jsname"),
        text: (el.innerText || "").trim().slice(0, 200),
      }));
    });
    const file = path.join(DEBUG_DIR, `${meetingId}-${step}-a11y.json`);
    await writeFile(file, JSON.stringify(nodes, null, 2));
    console.log(`[meeting-bot] Volcado de accesibilidad (${nodes.length} elementos): ${file}`);
  } catch (error) {
    console.warn("[meeting-bot] No se pudo volcar el árbol de accesibilidad:", error);
  }
}

async function sendAnnouncement(page: Page): Promise<void> {
  try {
    await openChatPanel(page);
    // Confirmado con un log real: el campo es "Envía un mensaje" (imperativo),
    // no "Enviar un mensaje" (infinitivo) como asumía antes.
    const input = page.getByRole("textbox", { name: /env[ií]a?r? un mensaje|send a message/i });
    await input.fill("Esta reunión se está grabando para transcripción interna.");
    await input.press("Enter");
    console.log("[meeting-bot] Aviso de grabación mandado por el chat.");
  } catch (error) {
    // El selector del chat de Meet es justamente lo más frágil de toda esta
    // integración — cambia con cada rediseño de Google. Si falla, seguir
    // grabando igual es mejor que cortar toda la reunión por esto. Se loguean
    // los botones visibles (no una captura/archivo, para no llenar disco) —
    // con eso alcanza para ajustar el selector la próxima vez sin adivinar.
    console.warn("[meeting-bot] No se pudo mandar el aviso de grabación por el chat:", error);
    await logToolbarButtons(page);
  }
}

/**
 * Un botón de chat directo en la barra de Meet no siempre está —
 * confirmado con un volcado de accesibilidad real que no encontró ninguno
 * con "chat" en el nombre en cierto momento. Como red de apoyo, si no
 * aparece directo, se prueba abriéndolo desde "Más opciones".
 */
async function openChatPanel(page: Page): Promise<void> {
  // Confirmado con un log real: el botón se llama "Chatear con todos" (no
  // "Chat con todos" -- el verbo conjugado, no el sustantivo solo).
  const directChatButton = page.getByRole("button", {
    name: /chatear con todos|chat con todos|mostrar chat|abrir chat|enviar chat|chat with everyone|show chat|open chat/i,
  });
  try {
    await directChatButton.click({ timeout: 5_000 });
    return;
  } catch {
    // Sigue con el fallback de "Más opciones".
  }

  await page.getByRole("button", { name: /más opciones|more options/i }).click({ timeout: 5_000 });
  await page.getByRole("menuitem", { name: /chat/i }).click({ timeout: 5_000 });
}

async function logToolbarButtons(page: Page): Promise<void> {
  try {
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="button"], [role="menuitem"]'))
        .map((el) => el.getAttribute("aria-label"))
        .filter((label): label is string => Boolean(label)),
    );
    console.log(`[meeting-bot] Botones visibles (para ajustar el selector del chat): ${JSON.stringify(labels)}`);
  } catch {
    // best-effort, no bloquea nada si falla.
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
  let sinceLastCheck = 0;
  // Confirmado con un log real: cuando Meet termina la reunión (o saca al
  // bot), navega a una pantalla sin el botón "Personas" -- antes, no poder
  // leerlo se interpretaba como "no estoy solo" y el bot se quedaba
  // grabando hasta el límite de duración+margen, sin darse cuenta nunca de
  // que la reunión ya había terminado. Dos fallos seguidos (con
  // END_CHECK_INTERVAL_MS de por medio) para no cortar por un glitch
  // pasajero de un solo chequeo.
  let consecutiveEndSignals = 0;

  // Se fija en `signal.aborted` cada 1s (para que "Detener bot" responda
  // casi al instante) pero solo consulta el DOM de participantes cada
  // END_CHECK_INTERVAL_MS — es una consulta más cara, no hace falta tan seguido.
  while (Date.now() < deadline) {
    if (signal.aborted) return;
    await page.waitForTimeout(1_000);
    sinceLastCheck += 1_000;
    if (sinceLastCheck >= END_CHECK_INTERVAL_MS) {
      sinceLastCheck = 0;
      if (await meetingLooksOver(page)) {
        consecutiveEndSignals += 1;
        console.log(`[meeting-bot] La reunión parece haber terminado (señal ${consecutiveEndSignals}/2).`);
        if (consecutiveEndSignals >= 2) return;
      } else {
        consecutiveEndSignals = 0;
      }
    }
  }
}

/**
 * true si el contador de participantes de Meet muestra 1 (solo el bot) o
 * menos, O si ya no se puede leer ese contador -- lo segundo, en la
 * práctica, casi siempre significa que Meet navegó lejos de la pantalla de
 * la llamada (reunión terminada, o el bot fue expulsado), no que "hay
 * alguien más" (que sería el significado de simplemente ignorar el error).
 */
async function meetingLooksOver(page: Page): Promise<boolean> {
  try {
    const text = await page.getByRole("button", { name: /personas|people/i }).first().innerText({ timeout: 5_000 });
    const match = text.match(/\d+/);
    return match ? Number(match[0]) <= 1 : false;
  } catch {
    return true;
  }
}
