// Corre en el "offscreen document": una página invisible de la extensión que sí tiene DOM y APIs de audio (el service
// worker no las tiene). Aquí se graba el audio de la reunión: las voces de los demás (tabCapture) mezcladas con tu
// micrófono, que solo suena mientras NO estás silenciado en Meet.
//
// El audio se corta en partes de 10 minutos; cada parte es un archivo completo que se sube al terminar. Así una pestaña
// cerrada o un fallo solo cuesta la parte en curso, la memoria no crece con reuniones largas y cada archivo queda muy por
// debajo del límite de 25 MB del transcriptor (a 24 kbps una hora pesa ~11 MB).
const SEGMENT_MS = 10 * 60 * 1000;
const BITRATE = 24000;
const MAX_UPLOAD_ATTEMPTS = 4;

let audioContext = null;
let tabStream = null;
let micStream = null;
let destination = null;
let recorder = null;
let segmentTimer = null;
let active = false;
let paused = false;
let micSource = null;
let session = null; // { tabId, meetingUrl, organizationId, title }
let stats = { part: 0, uploaded: 0, failed: 0, micEnabled: true, micAvailable: false, paused: false, micLabel: null, lastError: null };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function publish() {
  if (!session) return;
  chrome.runtime.sendMessage({ type: "AUDIO_STATE", tabId: session.tabId, state: { active, ...stats } }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_START") {
    startRecording(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));
    return true; // respuesta async
  }
  if (message?.type === "OFFSCREEN_STOP") {
    stopRecording();
    return false;
  }
  if (message?.type === "OFFSCREEN_PAUSE") {
    pauseRecording();
    return false;
  }
  if (message?.type === "OFFSCREEN_RESUME") {
    resumeRecording();
    return false;
  }
  if (message?.type === "OFFSCREEN_SET_MIC_DEVICE") {
    void switchMic(message.deviceId || "");
    return false;
  }
  if (message?.type === "OFFSCREEN_SET_MIC_ENABLED") {
    stats.micEnabled = Boolean(message.enabled);
    if (micStream) micStream.getAudioTracks().forEach((t) => (t.enabled = stats.micEnabled));
    publish();
    return false;
  }
  return false;
});

async function startRecording({ streamId, tabId, meetingUrl, organizationId, title }) {
  if (active) {
    if (session && session.tabId === tabId) return; // ya está grabando esta pestaña
    throw new Error("Ya hay una grabación de audio en otra pestaña.");
  }
  session = { tabId, meetingUrl, organizationId: organizationId || null, title: title || null };
  paused = false;
  stats = { part: 0, uploaded: 0, failed: 0, micEnabled: true, micAvailable: false, paused: false, micLabel: null, lastError: null };

  try {
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    });
  } catch (error) {
    session = null;
    throw new Error("No se pudo capturar el audio de la pestaña: " + (error && error.message ? error.message : error));
  }

  audioContext = new AudioContext();
  const tabSource = audioContext.createMediaStreamSource(tabStream);
  // Capturar la pestaña la silencia: sin esto dejarías de escuchar a los demás apenas se activa la grabación.
  tabSource.connect(audioContext.destination);
  destination = audioContext.createMediaStreamDestination();
  tabSource.connect(destination);

  await connectMic((await chrome.storage.local.get(["micDeviceId"])).micDeviceId || "");

  active = true;
  startSegment();
  publish();
}

// Abre el micrófono elegido (o el predeterminado) y lo mezcla en la grabación. Si el elegido ya no está (desenchufado),
// usa el predeterminado en vez de quedarse sin tu voz.
async function connectMic(deviceId) {
  const base = { echoCancellation: true, noiseSuppression: true };
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base });
  } catch (error) {
    if (deviceId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: base });
        stats.lastError = "El micrófono elegido no está disponible: se usa el predeterminado.";
      } catch (error2) {
        console.warn("[proshop-captions] Sin micrófono:", error2);
      }
    } else {
      // Sin permiso de micrófono (se concede una vez desde el popup): se graba igual, solo sin tu voz.
      console.warn("[proshop-captions] Sin micrófono:", error);
    }
  }
  if (!stream || !audioContext) {
    stats.micAvailable = false;
    stats.micLabel = null;
    return;
  }
  micStream = stream;
  micSource = audioContext.createMediaStreamSource(stream);
  micSource.connect(destination);
  stream.getAudioTracks().forEach((t) => (t.enabled = stats.micEnabled)); // respeta el silencio de Meet
  stats.micAvailable = true;
  stats.micLabel = (stream.getAudioTracks()[0] && stream.getAudioTracks()[0].label) || null;
}

// Cambia de micrófono sin cortar la grabación.
async function switchMic(deviceId) {
  if (!active || !audioContext) return;
  if (micSource) micSource.disconnect();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micSource = micStream = null;
  stats.lastError = null;
  await connectMic(deviceId);
  publish();
}

// Pausa: se cierra la parte en curso (se sube) y no se graba nada hasta reanudar.
function pauseRecording() {
  if (!active || paused) return;
  paused = true;
  stats.paused = true;
  if (recorder && recorder.state !== "inactive") recorder.stop();
  publish();
}
function resumeRecording() {
  if (!active || !paused) return;
  paused = false;
  stats.paused = false;
  startSegment();
  publish();
}

function startSegment() {
  const chunks = [];
  const rec = new MediaRecorder(destination.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: BITRATE });
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.onstop = () => {
    clearTimeout(segmentTimer);
    const blob = new Blob(chunks, { type: "audio/webm" });
    if (blob.size > 2000) {
      stats.part += 1;
      void uploadPart(blob, stats.part);
    }
    if (active) {
      if (!paused) startSegment();
    } else release();
  };
  rec.start(1000);
  recorder = rec;
  segmentTimer = setTimeout(() => rec.state !== "inactive" && rec.stop(), SEGMENT_MS);
}

function release() {
  for (const stream of [tabStream, micStream]) if (stream) stream.getTracks().forEach((t) => t.stop());
  if (audioContext && audioContext.state !== "closed") void audioContext.close();
  tabStream = micStream = micSource = audioContext = destination = recorder = null;
  paused = false;
  publish();
}

// Termina la grabación: la última parte se sube igual. Seguro de llamar varias veces.
function stopRecording() {
  if (!active) return;
  active = false;
  if (recorder && recorder.state !== "inactive") recorder.stop();
  else release();
  publish();
}

async function getStorageWithRetry(keys, attempts = 3, delayMs = 300) {
  for (let i = 0; i < attempts; i++) {
    if (chrome.storage?.local) return chrome.storage.local.get(keys);
    if (i < attempts - 1) await sleep(delayMs);
  }
  throw new Error("chrome.storage.local no está disponible");
}

async function uploadPart(blob, part) {
  const current = session; // la sesión puede cambiar si empieza otra reunión mientras sube
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
    try {
      const { apiBase, token } = await getStorageWithRetry(["apiBase", "token"]);
      if (!token) throw new Error("Sin sesión del CRM: vuelve a conectarte desde el ícono de la extensión.");
      const base = (apiBase || "https://chats.proshop.lat").replace(/\/$/, "");
      const res = await fetch(base + "/api/extension/audio", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Meeting-Url": current?.meetingUrl || "",
          "X-Audio-Part": String(part),
          ...(current?.organizationId ? { "X-Organization-Id": current.organizationId } : {}),
          // Los encabezados HTTP no admiten tildes ni emojis: va codificado y el servidor lo decodifica.
          ...(current?.title ? { "X-Meeting-Title": encodeURIComponent(current.title) } : {}),
          "Content-Type": "audio/webm",
        },
        body: blob,
      });
      if (res.status === 401) throw Object.assign(new Error("Sesión del CRM vencida: vuelve a conectarte."), { fatal: true });
      if (res.ok) {
        stats.uploaded += 1;
        stats.lastError = null;
        publish();
        return;
      }
      throw new Error(`El CRM respondió ${res.status}.`);
    } catch (error) {
      lastError = error;
      if (error && error.fatal) break;
      await sleep(4000 * attempt);
    }
  }
  stats.failed += 1;
  stats.lastError = lastError && lastError.message ? lastError.message : "No se pudo subir una parte del audio.";
  console.error(`[proshop-captions] No se pudo subir la parte ${part}:`, lastError);
  publish();
}
