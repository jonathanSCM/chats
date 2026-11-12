// Service worker de la extensión (versión solo subtítulos: sin audio, sin micrófono, sin captura de pestaña).
//  - guarda el estado en vivo de cada reunión (subtítulos, avisos) en chrome.storage.session para que el panel lateral y la
//    ventana separada lo muestren, aunque el service worker se duerma;
//  - abre el panel lateral y la ventana separada.
const STATE_PREFIX = "live:";

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
function setup() {
  // Panel lateral para todas las pestañas: el ícono abre el popup, y desde ahí se abre el panel.
  chrome.sidePanel?.setOptions({ path: "sidepanel.html", enabled: true }).catch(() => {});
  // El panel se abre desde el popup del ícono (popup.js).
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

// El ícono abre popup.html (crear/unirse a una reunión o abrir el panel).

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

// Registro de diagnóstico (últimos 80 eventos) que el panel muestra y permite copiar: sirve para ver por qué algo no arrancó.
function debug(text) {
  writeQueue = writeQueue
    .then(async () => {
      const { debug: current = [] } = await chrome.storage.session.get("debug");
      current.push({ t: new Date().toLocaleTimeString("es"), text: String(text).slice(0, 4000) });
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case "DEBUG":
      debug(message.text);
      return false;
    case "LIVE_STATE":
      void patchState(sender.tab?.id, message.state);
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
