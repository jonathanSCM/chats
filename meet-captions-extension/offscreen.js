// Corre en el "offscreen document" -- una página invisible de la extensión
// que sí tiene DOM y APIs de audio (a diferencia del service worker de
// background.js). Acá pasan dos cosas que un content script no puede hacer:
// 1. Capturar el audio de la pestaña con el streamId que dio tabCapture.
// 2. Mandar el archivo final al CRM sin toparse con CORS -- esta página es
//    un origen de la extensión (no el de meet.google.com), y con
//    host_permissions declarado, fetch() desde acá sale sin bloqueo de CORS
//    (a diferencia del content script, ver la nota en content.js/route.ts).
let audioContext = null;
let mediaRecorder = null;
let chunks = [];
let meetingUrl = null;
let micStream = null;
let tabStream = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_START") {
    // Antes esto era "dispara y olvida" -- background.js nunca sabía si la
    // grabación había arrancado de verdad, así que el popup siempre mostraba
    // "Audio activado" aunque tabCapture hubiera fallado en silencio.
    startRecording(message.streamId, message.meetingUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true; // respuesta async
  }
  if (message?.type === "OFFSCREEN_STOP") {
    void stopRecording();
  }
  if (message?.type === "OFFSCREEN_SET_MIC_ENABLED") {
    // Pausa/reanuda el track, no para/reinicia el stream -- así no hace
    // falta renegociar nada del pipeline de grabación (MediaRecorder sigue
    // corriendo igual, solo que sin audio de mic mientras está muteado).
    micStream?.getAudioTracks().forEach((t) => (t.enabled = message.enabled));
  }
  return false;
});

async function startRecording(streamId, url) {
  if (mediaRecorder && mediaRecorder.state !== "inactive") return; // ya está grabando

  meetingUrl = url;
  chunks = [];

  // Antes, si esto tiraba error (streamId vencido, otra captura ya activa
  // sobre la misma pestaña, etc.) la promesa quedaba sin manejar -- todo el
  // resto de la función nunca corría, mediaRecorder quedaba null, y
  // stopRecording() más tarde no hacía nada ("audio no me lo guardó" sin
  // ningún rastro de por qué). Ahora se loguea fuerte para poder
  // diagnosticarlo desde la consola del offscreen document
  // (chrome://extensions → "Inspeccionar vistas: offscreen.html").
  try {
    tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
      },
    });
  } catch (error) {
    console.error("[proshop-captions] No se pudo capturar el audio de la pestaña -- grabación de audio cancelada:", error);
    throw error; // para que quien llamó (background.js) se entere y avise en el popup
  }

  audioContext = new AudioContext();
  const tabSource = audioContext.createMediaStreamSource(tabStream);
  // getUserMedia con chromeMediaSource:"tab" silencia la pestaña mientras se
  // captura -- sin esto, quien está en la reunión dejaría de escuchar a los
  // demás apenas se activa la grabación.
  tabSource.connect(audioContext.destination);

  const destination = audioContext.createMediaStreamDestination();
  tabSource.connect(destination);

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext.createMediaStreamSource(micStream).connect(destination);
  } catch (error) {
    // Sin permiso de micrófono todavía concedido (hace falta activarlo una
    // vez desde el popup, un offscreen document no puede mostrar el diálogo
    // de permiso) -- se sigue grabando igual, solo que sin la voz propia.
    console.warn("[proshop-captions] Sin micrófono -- revisá 'Activar micrófono' en el popup:", error);
  }

  mediaRecorder = new MediaRecorder(destination.stream, { mimeType: "audio/webm;codecs=opus" });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.start(1000);
  console.log("[proshop-captions] Grabación de audio iniciada.");
}

async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;

  const stopped = new Promise((resolve) => {
    mediaRecorder.onstop = resolve;
  });
  mediaRecorder.stop();
  await stopped;

  tabStream?.getTracks().forEach((t) => t.stop());
  micStream?.getTracks().forEach((t) => t.stop());
  await audioContext?.close();
  tabStream = null;
  micStream = null;
  audioContext = null;

  const blob = new Blob(chunks, { type: "audio/webm" });
  chunks = [];
  console.log(`[proshop-captions] Grabación terminada (${blob.size} bytes). Subiendo…`);

  const { apiBase, token } = await chrome.storage.local.get(["apiBase", "token"]);
  if (!token) {
    console.warn("[proshop-captions] Sin token configurado -- no se manda el audio.");
    return;
  }
  const base = (apiBase || "https://chats.proshop.lat").replace(/\/$/, "");

  try {
    const res = await fetch(base + "/api/extension/audio", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Meeting-Url": meetingUrl || "",
        "Content-Type": "audio/webm",
      },
      body: blob,
    });
    const data = await res.json().catch(() => null);
    console.log("[proshop-captions] Audio enviado:", res.status, data);
  } catch (error) {
    console.error("[proshop-captions] No se pudo mandar el audio:", error);
  }
}
