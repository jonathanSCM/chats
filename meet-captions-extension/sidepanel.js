// Panel lateral (y ventana separada) del asistente: muestra en vivo los subtítulos que se están guardando, el estado del
// audio y los avisos, y permite pausar, detener y enviar, y ajustar el micrófono y otras opciones. Solo lee el estado que
// guarda background.js en chrome.storage.session; los ajustes se guardan en chrome.storage.local.
const MEETING_URL_RE = /^https:\/\/meet\.google\.com\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
const params = new URLSearchParams(location.search);
const detached = params.get("detached") === "1";
let tabId = params.get("tab") ? Number(params.get("tab")) : null;
let lastState = null;

const $ = (id) => document.getElementById(id);
const dot = $("dot");
const subtitle = $("subtitle");
const chips = $("chips");
const notices = $("notices");
const captions = $("captions");
const stopBtn = $("stopBtn");
const pauseBtn = $("pauseBtn");
const detachBtn = $("detachBtn");
const hideToggle = $("hideToggle");
const autoOpenToggle = $("autoOpenToggle");
const langSelect = $("langSelect");
const micSelect = $("micSelect");
const micHint = $("micHint");
const settings = $("settings");
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
  pauseBtn.disabled = true;
  pauseBtn.textContent = "Pausar";

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
  lastState = state || null;

  if (!state || (!state.recording && !state.stopped)) {
    dot.className = "dot";
    subtitle.textContent = "Reunión detectada";
    notices.append(notice("Para grabar: abre el ícono de la extensión y pulsa «Grabar esta reunión».", "info"));
    renderCaptions([]);
    return;
  }

  const audio = state.audio || {};
  const paused = Boolean(state.paused);
  dot.className = "dot" + (state.recording ? (paused ? " pause" : " rec") : "");
  subtitle.textContent = state.recording ? (paused ? "Grabación en pausa" : "Grabando esta reunión") : "Grabación terminada";
  stopBtn.disabled = !state.recording;
  pauseBtn.disabled = !state.recording;
  pauseBtn.textContent = paused ? "Reanudar" : "Pausar";

  if (paused) chips.append(chip("En pausa: no se guarda nada", "warn"));
  chips.append(chip(`Subtítulos: ${state.lines || 0} líneas`, state.lines ? "ok" : ""));
  if (audio.active) chips.append(chip(`Audio: ${paused ? "en pausa" : "grabando"} · ${audio.uploaded || 0} partes enviadas`, paused ? "warn" : "ok"));
  else if (audio.lastError || audio.failed) chips.append(chip("Audio: con problemas", "bad"));
  else chips.append(chip(state.stopped ? "Audio: terminado" : "Audio: sin grabar"));
  if (audio.active && audio.micAvailable) {
    const name = audio.micLabel ? ` (${audio.micLabel.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "")})` : "";
    chips.append(chip(state.micMuted ? "Micrófono: silenciado (no se graba)" : "Micrófono: grabando" + name));
  }

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

// ───────── Botones ─────────
pauseBtn.addEventListener("click", async () => {
  if (tabId == null || !lastState) return;
  const pausing = !lastState.paused;
  pauseBtn.disabled = true;
  try {
    await chrome.tabs.sendMessage(tabId, { type: pausing ? "PAUSE_RECORDING" : "RESUME_RECORDING" });
  } catch {
    /* la pestaña ya no está */
  }
  chrome.runtime.sendMessage({ type: pausing ? "OFFSCREEN_PAUSE" : "OFFSCREEN_RESUME" }).catch(() => {});
  void render();
});

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

// ───────── Ajustes ─────────
async function loadSettings() {
  const s = await chrome.storage.local.get(["hideMeetCaptions", "autoOpenWindow", "captionLang", "micDeviceId"]);
  hideToggle.checked = s.hideMeetCaptions !== false;
  autoOpenToggle.checked = Boolean(s.autoOpenWindow);
  langSelect.value = s.captionLang || "es";
  await loadMics(s.micDeviceId || "");
}

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
autoOpenToggle.addEventListener("change", () => chrome.storage.local.set({ autoOpenWindow: autoOpenToggle.checked }));
langSelect.addEventListener("change", () => chrome.storage.local.set({ captionLang: langSelect.value }));

// Micrófonos: la lista sale del navegador; los nombres solo aparecen si el permiso del micrófono ya se concedió a la
// extensión (botón «Activar micrófono» del ícono).
async function loadMics(selectedId) {
  let devices = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications");
  } catch {
    /* sin acceso a los dispositivos */
  }
  micSelect.replaceChildren();
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Predeterminado del sistema";
  micSelect.append(def);
  const named = devices.some((d) => d.label);
  devices.forEach((d, i) => {
    const option = document.createElement("option");
    option.value = d.deviceId;
    option.textContent = d.label || `Micrófono ${i + 1}`;
    micSelect.append(option);
  });
  micSelect.value = devices.some((d) => d.deviceId === selectedId) ? selectedId : "";
  micHint.textContent = named
    ? "Habla para ver si se mueve la barra: así sabes que ese es el micrófono correcto."
    : "Para ver los nombres de tus micrófonos, pulsa «Activar micrófono» en el ícono de la extensión (una sola vez).";
}

micSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ micDeviceId: micSelect.value });
  chrome.runtime.sendMessage({ type: "OFFSCREEN_SET_MIC_DEVICE", deviceId: micSelect.value }).catch(() => {}); // en vivo si ya graba
  if (settings.open) void startMeter();
});
navigator.mediaDevices.addEventListener?.("devicechange", () => void loadSettings());

// Medidor de nivel del micrófono elegido (solo mientras los Ajustes están abiertos, y solo en este panel).
let meterStream = null;
let meterCtx = null;
let meterFrame = 0;
const meterBar = $("meterBar");
function stopMeter() {
  cancelAnimationFrame(meterFrame);
  if (meterStream) meterStream.getTracks().forEach((t) => t.stop());
  if (meterCtx && meterCtx.state !== "closed") void meterCtx.close();
  meterStream = meterCtx = null;
  meterBar.style.width = "0";
}
async function startMeter() {
  stopMeter();
  try {
    meterStream = await navigator.mediaDevices.getUserMedia({ audio: micSelect.value ? { deviceId: { exact: micSelect.value } } : true });
  } catch {
    return; // sin permiso o sin micrófono: la barra queda quieta
  }
  meterCtx = new AudioContext();
  const analyser = meterCtx.createAnalyser();
  analyser.fftSize = 512;
  meterCtx.createMediaStreamSource(meterStream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += ((v - 128) / 128) ** 2;
    meterBar.style.width = Math.min(100, Math.round(Math.sqrt(sum / data.length) * 320)) + "%";
    meterFrame = requestAnimationFrame(tick);
  };
  tick();
}
settings.addEventListener("toggle", () => (settings.open ? void startMeter() : stopMeter()));
window.addEventListener("pagehide", stopMeter);

// ───────── Arranque ─────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") void render();
});
if (!detached) {
  chrome.tabs.onActivated.addListener(() => void render());
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.url || info.status === "complete") void render();
  });
}
void loadSettings();
void render();
