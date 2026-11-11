// Panel lateral (y ventana separada) del asistente: muestra en vivo los subtítulos que se están guardando, el estado del
// audio y los avisos, y permite detener y enviar. Solo lee el estado que guarda background.js en chrome.storage.session.
const MEETING_URL_RE = /^https:\/\/meet\.google\.com\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
const params = new URLSearchParams(location.search);
const detached = params.get("detached") === "1";
let tabId = params.get("tab") ? Number(params.get("tab")) : null;

const $ = (id) => document.getElementById(id);
const dot = $("dot");
const subtitle = $("subtitle");
const chips = $("chips");
const notices = $("notices");
const captions = $("captions");
const stopBtn = $("stopBtn");
const detachBtn = $("detachBtn");
const hideToggle = $("hideToggle");
$("ver").textContent = "ProShop CRM · extensión v" + chrome.runtime.getManifest().version;
if (detached) detachBtn.style.display = "none";

function chip(text, kind) {
  const el = document.createElement("span");
  el.className = "chip" + (kind ? " " + kind : "");
  el.textContent = text;
  return el;
}
function notice(text, kind) {
  const el = document.createElement("div");
  el.className = "notice " + kind;
  el.textContent = text;
  return el;
}

async function resolveTab() {
  if (tabId != null) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function renderCaptions(lines) {
  const nearBottom = captions.scrollHeight - captions.scrollTop - captions.clientHeight < 60;
  captions.replaceChildren();
  if (!lines || lines.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Los subtítulos aparecen aquí cuando alguien hable.";
    captions.append(p);
    return;
  }
  for (const line of lines) {
    const p = document.createElement("p");
    const i = line.indexOf(": ");
    if (i > 0 && i < 40) {
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = line.slice(0, i) + ":";
      p.append(who, document.createTextNode(line.slice(i + 2)));
    } else {
      p.textContent = line;
    }
    captions.append(p);
  }
  if (nearBottom) captions.scrollTop = captions.scrollHeight;
}

async function render() {
  const tab = await resolveTab();
  chips.replaceChildren();
  notices.replaceChildren();
  stopBtn.disabled = true;

  if (!tab || !tab.url || !MEETING_URL_RE.test(tab.url)) {
    dot.className = "dot";
    subtitle.textContent = "Asistente de reunión";
    notices.append(notice("Abre una reunión de Google Meet para usar el asistente.", "info"));
    renderCaptions([]);
    return;
  }
  tabId = tab.id;
  const key = "live:" + tab.id;
  const stored = await chrome.storage.session.get(key);
  const state = stored[key];

  if (!state || (!state.recording && !state.stopped)) {
    dot.className = "dot";
    subtitle.textContent = "Reunión detectada";
    notices.append(notice("Para grabar: abre el ícono de la extensión y pulsa «Grabar esta reunión».", "info"));
    renderCaptions([]);
    return;
  }

  const audio = state.audio || {};
  dot.className = "dot" + (state.recording ? " rec" : "");
  subtitle.textContent = state.recording ? "Grabando esta reunión" : "Grabación terminada";
  stopBtn.disabled = !state.recording;

  chips.append(chip(`Subtítulos: ${state.lines || 0} líneas`, state.lines ? "ok" : ""));
  if (audio.active) chips.append(chip(`Audio: grabando · ${audio.uploaded || 0} partes enviadas`, "ok"));
  else if (audio.lastError || audio.failed) chips.append(chip("Audio: con problemas", "bad"));
  else chips.append(chip(state.stopped ? "Audio: terminado" : "Audio: sin grabar"));
  if (audio.active && audio.micAvailable) chips.append(chip(state.micMuted ? "Micrófono: silenciado (no se graba)" : "Micrófono: grabando"));

  if (state.warning) notices.append(notice(state.warning, "warn"));
  if (audio.lastError) notices.append(notice("Audio: " + audio.lastError, "error"));
  if (audio.failed) notices.append(notice(`${audio.failed} parte(s) del audio no se pudieron subir.`, "error"));
  if (state.recording && !audio.active && audio.part === undefined && !audio.lastError) {
    notices.append(notice("El audio no está grabando: usa «Grabar esta reunión» desde el ícono para activarlo.", "warn"));
  }
  if (state.stopped) notices.append(notice("Los subtítulos y el audio ya se enviaron al CRM.", "info"));

  hideToggle.checked = state.hideMeetCaptions !== false;
  renderCaptions(state.last);
}

stopBtn.addEventListener("click", async () => {
  if (tabId == null) return;
  stopBtn.disabled = true;
  stopBtn.textContent = "Enviando…";
  try {
    await chrome.tabs.sendMessage(tabId, { type: "STOP_AND_SEND" });
  } catch {
    /* la pestaña ya no está: nada que enviar desde aquí */
  }
  stopBtn.textContent = "Detener y enviar";
  void render();
});

detachBtn.addEventListener("click", () => {
  if (tabId == null) return;
  chrome.runtime.sendMessage({ type: "OPEN_DETACHED", tabId });
  window.close(); // el panel lateral se cierra; la ventana nueva sigue mostrando lo mismo
});

hideToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ hideMeetCaptions: hideToggle.checked });
  if (tabId != null) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "SET_HIDE_CAPTIONS", hidden: hideToggle.checked });
    } catch {
      /* sin grabación activa en esa pestaña: queda guardado para la próxima */
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") void render();
});
if (!detached) {
  chrome.tabs.onActivated.addListener(() => void render());
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.url || info.status === "complete") void render();
  });
}
void render();
