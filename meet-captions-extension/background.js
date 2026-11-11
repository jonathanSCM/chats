// Service worker de la extensión. No tiene DOM ni APIs de audio, así que solo coordina:
//  - pide el streamId de la pestaña con chrome.tabCapture (hace falta haber invocado la extensión desde su ícono) y lo
//    pasa al offscreen document, que es quien graba el audio;
//  - guarda el estado en vivo de cada reunión (subtítulos, audio, avisos) en chrome.storage.session para que el panel
//    lateral y la ventana separada lo muestren, aunque el service worker se duerma;
//  - abre la ventana separada del panel.
const STATE_PREFIX = "live:";
let creatingOffscreen = null;

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
function setup() {
  // Panel lateral para todas las pestañas: el ícono abre el popup, y desde ahí se abre el panel.
  chrome.sidePanel?.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});
  // OJO: NO se usa openPanelOnActionClick. Con esa opción Chrome abre el panel pero no cuenta el clic como «invocar la
  // extensión», y la captura del audio de la pestaña falla con «Extension has not been invoked for the current page». El panel
  // se abre desde chrome.action.onClicked (abajo), que sí concede el permiso activeTab para esa pestaña. Se fija en falso a
  // propósito: versiones anteriores lo dejaron en verdadero y Chrome lo recuerda.
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
}

// Las escrituras van en fila: antes, dos avisos casi a la vez (subtítulos y audio) leían el mismo estado y el último en
// escribir borraba lo del otro, y el panel podía decir «audio sin grabar» con el audio andando.
let writeQueue = Promise.resolve();
function patchState(tabId, patch) {
  if (tabId == null) return Promise.resolve();
  writeQueue = writeQueue
    .then(async () => {
      const key = STATE_PREFIX + tabId;
      const stored = await chrome.storage.session.get(key);
      await chrome.storage.session.set({ [key]: { ...(stored[key] || {}), ...patch, updatedAt: Date.now() } });
    })
    .catch(() => {});
  return writeQueue;
}

// Pestañas donde la persona hizo clic en el ícono: ahí Chrome deja capturar el audio (activeTab). El panel lo consulta para
// decidir entre la captura automática y el selector de pestañas.
const invoked = new Set();
chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return;
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => openDetached(tab.id)); // sin ningún await antes: necesita el gesto del clic
  invoked.add(tab.id);
  debug(`[icono] clic en el ícono (pestaña ${tab.id}): la captura automática de audio queda permitida en esta pestaña`);
});

const MEETING_URL_RE = /^https:\/\/meet\.google\.com\/(?:meet\/)?[a-z]{3}-[a-z]{4}-[a-z]{3}/i;
const detachedWindows = new Map(); // tabId -> id de la ventana separada (para no abrir dos)
const autoOpened = new Set(); // pestañas donde ya se abrió sola la ventana

async function openDetached(tabId, { focused = true } = {}) {
  const known = detachedWindows.get(tabId);
  if (known != null) {
    try {
      await chrome.windows.update(known, { focused: true });
      return;
    } catch {
      detachedWindows.delete(tabId); // la cerraron: se abre otra
    }
  }
  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL(`sidepanel.html?tab=${tabId}&detached=1`),
      type: "popup",
      width: 420,
      height: 680,
      focused,
    });
    if (win?.id != null) detachedWindows.set(tabId, win.id);
  } catch (error) {
    console.error("[proshop-captions] No se pudo abrir la ventana:", error);
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [tabId, id] of detachedWindows) if (id === windowId) detachedWindows.delete(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(STATE_PREFIX + tabId).catch(() => {});
  autoOpened.delete(tabId);
  invoked.delete(tabId);
});

// Registro de diagnóstico (últimos 80 eventos) que el panel muestra y permite copiar: sirve para ver por qué algo no arrancó.
function debug(text) {
  writeQueue = writeQueue
    .then(async () => {
      const { debug: current = [] } = await chrome.storage.session.get("debug");
      current.push({ t: new Date().toLocaleTimeString("es"), text: String(text).slice(0, 400) });
      await chrome.storage.session.set({ debug: current.slice(-80) });
    })
    .catch(() => {});
}

// Opción «abrir la ventana sola al entrar a una reunión» (se activa desde el ícono). Se abre una vez por pestaña y sin
// quitarle el foco a Meet.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url || !MEETING_URL_RE.test(tab.url) || autoOpened.has(tabId)) return;
  chrome.storage.local.get(["autoOpenWindow"]).then(({ autoOpenWindow }) => {
    if (!autoOpenWindow || autoOpened.has(tabId)) return;
    autoOpened.add(tabId);
    void openDetached(tabId, { focused: false });
  });
});

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "Graba el audio de la reunión de Meet (pestaña + micrófono) para transcribirlo y guardarlo en el CRM.",
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "START_AUDIO_CAPTURE": {
      (async () => {
        try {
          debug(`[audio] pedido recibido (pestaña ${message.tabId})`);
          await patchState(message.tabId, { audio: { active: false, starting: true } });
          // Normal: Chrome da el id de la pestaña (hace falta haber usado el ícono de la extensión). Plan B: el panel ya trae un id
          // elegido por la persona con el selector de pestañas de Chrome (no depende de ese permiso).
          const streamId = message.streamId || (await chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId }));
          debug(message.streamId ? "[audio] pestaña elegida con el selector de Chrome" : "[audio] Chrome dio permiso para capturar la pestaña");
          await ensureOffscreenDocument();
          debug("[audio] página de grabación lista");
          // La página del grabador es invisible y Chrome NO le da acceso a chrome.storage (solo a chrome.runtime): la sesión del
          // CRM y el micrófono elegido se le pasan aquí, en el mensaje de inicio.
          const { token, apiBase, micDeviceId, recordMic } = await chrome.storage.local.get(["token", "apiBase", "micDeviceId", "recordMic"]);
          const started = await chrome.runtime.sendMessage({
            type: "OFFSCREEN_START",
            streamId,
            source: message.streamId ? "desktop" : "tab",
            token: token || null,
            apiBase: apiBase || null,
            micDeviceId: micDeviceId || "",
            recordMic: recordMic !== false,
            recordingId: message.recordingId || null,
            tabId: message.tabId,
            meetingUrl: message.meetingUrl,
            organizationId: message.organizationId || null,
            title: message.title || null,
          });
          debug(`[audio] la grabación respondió: ${started?.ok === false ? "error: " + started.error : started?.ok ? "ok" : "sin respuesta"}`);
          if (started?.ok === false) {
            await patchState(message.tabId, { audio: { active: false, lastError: started.error } });
            sendResponse({ ok: false, error: started.error });
            return;
          }
          sendResponse({ ok: true });
        } catch (error) {
          console.error("[proshop-captions] No se pudo iniciar la captura de audio:", error);
          debug(`[audio] ERROR al iniciar: ${error && error.message ? error.message : error}`);
          if (/invoked|activeTab/i.test(String(error))) invoked.delete(message.tabId); // el permiso no está: el panel usará el selector
          await patchState(message.tabId, { audio: { active: false, lastError: String(error) } });
          sendResponse({ ok: false, error: String(error) });
        }
      })();
      return true; // respuesta async
    }
    case "STOP_AUDIO_CAPTURE":
      // Si nunca se activó el audio en esta reunión, no hay nadie escuchando y no pasa nada.
      chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" }).catch(() => {});
      return false;
    case "SET_MIC_ENABLED":
      chrome.runtime.sendMessage({ type: "OFFSCREEN_SET_MIC_ENABLED", enabled: message.enabled }).catch(() => {});
      return false;
    case "IS_INVOKED":
      sendResponse({ invoked: invoked.has(message.tabId) });
      return false;
    case "DEBUG":
      debug(message.text);
      return false;
    case "LIVE_STATE":
      void patchState(sender.tab?.id, message.state);
      return false;
    case "AUDIO_STATE":
      void patchState(message.tabId, { audio: message.state });
      return false;
    case "GET_TAB_ID":
      sendResponse({ tabId: sender.tab?.id ?? null });
      return false;
    case "OPEN_DETACHED":
      void openDetached(message.tabId);
      return false;
    case "OPEN_PANEL": {
      // Lo manda el botón «PS» de la pestaña de Meet. Si Chrome no deja abrir el panel lateral, se abre la ventana separada.
      const tabId = sender.tab?.id;
      if (tabId == null) return false;
      chrome.sidePanel.open({ tabId }).catch(() => openDetached(tabId));
      return false;
    }
    default:
      return false;
  }
});

setup();
