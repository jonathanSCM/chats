// Service worker de la extensión. Los service workers no tienen DOM ni
// APIs de audio (AudioContext, MediaRecorder) -- por eso la grabación real
// de audio vive en un "offscreen document" (offscreen.js), y este archivo
// solo hace de coordinador: pide el streamId de la pestaña con
// chrome.tabCapture (API que SÍ requiere estar en un contexto con el
// permiso "tabCapture", no un content script) y se lo pasa al offscreen doc.
let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "Graba el audio de la reunión de Meet (tab + micrófono) para transcribirlo con whisper.cpp.",
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "START_AUDIO_CAPTURE") {
    (async () => {
      try {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId });
        await ensureOffscreenDocument();
        // Antes esto no esperaba la respuesta del offscreen document, así que
        // el popup mostraba "Audio activado" incluso si tabCapture fallaba
        // adentro -- ahora si el offscreen document avisa que no pudo
        // arrancar, eso se propaga hasta acá.
        const started = await chrome.runtime.sendMessage({
          type: "OFFSCREEN_START",
          streamId,
          meetingUrl: message.meetingUrl,
        });
        if (started?.ok === false) {
          sendResponse({ ok: false, error: started.error });
          return;
        }
        sendResponse({ ok: true });
      } catch (error) {
        console.error("[proshop-captions] No se pudo iniciar la captura de audio:", error);
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true; // respuesta async
  }

  if (message?.type === "STOP_AUDIO_CAPTURE") {
    // Broadcast simple -- si no hay offscreen document escuchando (nunca se
    // activó el audio en esta reunión), esto no hace nada, sin error.
    chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" });
    return false;
  }

  if (message?.type === "SET_MIC_ENABLED") {
    // Mismo patrón: broadcast, no-op silencioso si no hay offscreen document
    // (nunca se activó audio en esta reunión).
    chrome.runtime.sendMessage({ type: "OFFSCREEN_SET_MIC_ENABLED", enabled: message.enabled });
    return false;
  }

  return false;
});
