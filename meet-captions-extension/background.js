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
  chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
}

async function patchState(tabId, patch) {
  if (tabId == null) return;
  const key = STATE_PREFIX + tabId;
  const stored = await chrome.storage.session.get(key);
  await chrome.storage.session.set({ [key]: { ...(stored[key] || {}), ...patch, updatedAt: Date.now() } });
}

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
});

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
          const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId });
          await ensureOffscreenDocument();
          const started = await chrome.runtime.sendMessage({
            type: "OFFSCREEN_START",
            streamId,
            tabId: message.tabId,
            meetingUrl: message.meetingUrl,
            organizationId: message.organizationId || null,
            title: message.title || null,
          });
          if (started?.ok === false) {
            await patchState(message.tabId, { audio: { active: false, lastError: started.error } });
            sendResponse({ ok: false, error: started.error });
            return;
          }
          sendResponse({ ok: true });
        } catch (error) {
          console.error("[proshop-captions] No se pudo iniciar la captura de audio:", error);
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
