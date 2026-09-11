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

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "OFFSCREEN_START") {
    void startRecording(message.streamId, message.meetingUrl);
  }
  if (message?.type === "OFFSCREEN_STOP") {
    void stopRecording();
  }
});

async function startRecording(streamId, url) {
  if (mediaRecorder && mediaRecorder.state !== "inactive") return; // ya está grabando

  meetingUrl = url;
  chunks = [];

  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
  });

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
