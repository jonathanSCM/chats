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
const dest = $("dest");
const accountBox = $("accountBox");
const recordBox = $("recordBox");
const titleInput = $("titleInput");
const orgField = $("orgField");
const orgSelect = $("orgSelect");
const orgOnly = $("orgOnly");
const recordBtn = $("recordBtn");
const joinBtn = $("joinBtn");
const recordStatus = $("recordStatus");
const loginBtn = $("loginBtn");
const logoutBtn = $("logoutBtn");
const accountLine = $("accountLine");
const CRM_BASE = "https://chats.proshop.lat";
let meetingUrl = null;
$("ver").textContent = "ProShop CRM · extensión v" + chrome.runtime.getManifest().version;
if (detached) detachBtn.style.display = "none";

function chip(text, kind) {
  const el = document.createElement("span");
  el.className = "chip" + (kind ? " " + kind : "");
  el.textContent = text;
  return el;
}
function notice(text, kind, buttonLabel, onClick) {
  const el = document.createElement("div");
  el.className = "notice " + kind;
  el.textContent = text;
  if (buttonLabel) {
    const button = document.createElement("button");
    button.textContent = buttonLabel;
    button.addEventListener("click", onClick);
    el.append(document.createElement("br"), button);
  }
  return el;
}

// A qué organización va la reunión: la elegida al grabar o, si no, la activa del CRM.
async function renderDest(state, future) {
  const s = await chrome.storage.local.get(["orgList", "activeOrganizationId", "token", "apiBase"]);
  let list = s.orgList;
  let active = s.activeOrganizationId;
  if (!list && s.token) {
    try {
      const base = (s.apiBase || "https://chats.proshop.lat").replace(/\/$/, "");
      const res = await fetch(`${base}/api/extension/me`, { headers: { Authorization: `Bearer ${s.token}` } });
      if (res.ok) {
        const me = await res.json();
        list = (me.organizations || []).map((o) => ({ id: o.id, name: o.name }));
        active = me.activeOrganizationId;
        await chrome.storage.local.set({ orgList: list, activeOrganizationId: active });
      }
    } catch {
      /* sin conexión: no se muestra el nombre */
    }
  }
  const id = (state && state.organizationId) || active;
  const org = list && list.find((o) => o.id === id);
  const title = state && state.title ? " · " + state.title : "";
  dest.textContent = org ? `${future ? "Se enviará a" : "Se envía a"}: ${org.name}${title}` : title ? "Reunión" + title : "";
}

// Permiso del micrófono: este panel SÍ es una página visible, así que el aviso de Chrome aparece solo aquí (el ícono se
// cierra al perder el foco y la grabación corre en una página invisible que no puede pedirlo).
let micPromptTried = false;
async function ensureMicPermission() {
  let status = "prompt";
  try {
    status = (await navigator.permissions.query({ name: "microphone" })).state;
  } catch {
    /* sin API de permisos: se intenta pedir directo */
  }
  if (status === "granted") {
    await chrome.storage.local.set({ micGranted: true });
    return "granted";
  }
  if (status === "denied") return "denied";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    await chrome.storage.local.set({ micGranted: true });
    return "granted";
  } catch (error) {
    return error && error.name === "NotAllowedError" ? "denied" : "error";
  }
}
async function reconnectMic() {
  const { micDeviceId } = await chrome.storage.local.get(["micDeviceId"]);
  chrome.runtime.sendMessage({ type: "OFFSCREEN_SET_MIC_DEVICE", deviceId: micDeviceId || "" }).catch(() => {});
  void loadSettings(); // ahora sí se ven los nombres de los micrófonos
}
async function askMic(manual) {
  const result = await ensureMicPermission();
  if (result === "granted") await reconnectMic();
  else if (manual) chrome.tabs.create({ url: chrome.runtime.getURL("permissions.html") }); // explica cómo desbloquearlo
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
  const auth = await chrome.storage.local.get(["token", "userName", "apiBase"]);
  renderAccount(auth);
  recordBox.style.display = "none";
  chips.replaceChildren();
  notices.replaceChildren();
  stopBtn.disabled = true;
  pauseBtn.disabled = true;
  pauseBtn.textContent = "Pausar";

  if (!tab || !tab.url || !MEETING_URL_RE.test(tab.url)) {
    dot.className = "dot";
    subtitle.textContent = "Asistente de reunión";
    dest.textContent = "";
    notices.append(notice("Abre una reunión de Google Meet para usar el asistente.", "info"));
    renderCaptions([]);
    return;
  }
  tabId = tab.id;
  meetingUrl = `https://meet.google.com/${tab.url.match(MEETING_URL_RE)[1].toLowerCase()}`;
  const key = "live:" + tab.id;
  const stored = await chrome.storage.session.get(key);
  const state = stored[key];
  lastState = state || null;
  await renderDest(state, !state || (!state.recording && !state.stopped));

  // Sin sesión: el botón para iniciarla ya está arriba (accountBox); aquí solo se explica por qué no se puede grabar.
  if (!auth.token) {
    dot.className = "dot";
    subtitle.textContent = "Reunión detectada";
    notices.append(notice("Inicia sesión con el CRM para poder grabar esta reunión.", "info"));
    renderCaptions([]);
    return;
  }

  if (!state || (!state.recording && !state.stopped)) {
    dot.className = "dot";
    subtitle.textContent = "Reunión detectada";
    void showRecordBox(auth.token); // todo para empezar a grabar está en este mismo panel
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
  else if (audio.starting) chips.append(chip("Audio: iniciando…"));
  else if (audio.lastError || audio.failed) chips.append(chip("Audio: con problemas", "bad"));
  else chips.append(chip(state.stopped ? "Audio: terminado" : "Audio: sin grabar"));
  if (audio.active && audio.micAvailable) {
    const name = audio.micLabel ? ` (${audio.micLabel.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "")})` : "";
    chips.append(chip(state.micMuted ? "Micrófono: silenciado (no se graba)" : "Micrófono: grabando" + name));
  }

  if (state.warning) notices.append(notice(state.warning, "warn"));
  if (state.recording && audio.active && audio.micState && audio.micState !== "ok") {
    notices.append(
      notice(
        audio.micState === "denied"
          ? "El micrófono está bloqueado para la extensión: tu voz no se está grabando."
          : "La extensión necesita permiso para usar tu micrófono: tu voz todavía no se graba.",
        "warn",
        "Permitir micrófono",
        () => void askMic(true),
      ),
    );
    if (!micPromptTried) {
      micPromptTried = true;
      void askMic(false); // Chrome muestra el aviso «quiere usar tu micrófono» solo, sin buscar ningún botón
    }
  }
  if (audio.lastError) notices.append(notice("Audio: " + friendlyAudioError(audio.lastError), "error"));
  if (audio.failed) notices.append(notice(`${audio.failed} parte(s) del audio no se pudieron subir.`, "error"));
  if (state.recording && !audio.active && !audio.starting && audio.part === undefined && !audio.lastError) {
    notices.append(notice("El audio no está grabando. Haz clic en el ícono de la extensión (barra de Chrome) para abrir el panel desde ahí y pulsa «Grabar» otra vez.", "warn"));
  }
  if (state.stopped) notices.append(notice("Los subtítulos y el audio ya se enviaron al CRM.", "info"));

  hideToggle.checked = state.hideMeetCaptions !== false;
  renderCaptions(state.last);
}

// ───────── Cuenta, organización y botón de grabar (todo en este panel) ─────────
function friendlyAudioError(message) {
  if (/invoked|activeTab|not been invoked/i.test(message)) {
    return "Chrome no dejó capturar el audio de esta pestaña. Haz clic en el ícono de la extensión (barra de Chrome) para abrir el panel desde ahí, y vuelve a pulsar «Grabar».";
  }
  return message;
}

function renderAccount(auth) {
  accountBox.style.display = auth.token ? "none" : "block";
  accountLine.textContent = auth.token ? "Conectado" + (auth.userName ? " como " + auth.userName : "") : "Sin conectar";
  logoutBtn.style.display = auth.token ? "inline" : "none";
}

async function loadOrgs(token) {
  if (orgSelect.dataset.loaded === token) return;
  try {
    const s = await chrome.storage.local.get(["apiBase", "orgId"]);
    const base = (s.apiBase || CRM_BASE).replace(/\/$/, "");
    const res = await fetch(`${base}/api/extension/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const me = await res.json();
    const orgs = me.organizations || [];
    await chrome.storage.local.set({ orgList: orgs.map((o) => ({ id: o.id, name: o.name })), activeOrganizationId: me.activeOrganizationId });
    orgSelect.replaceChildren(
      ...orgs.map((o) => {
        const option = document.createElement("option");
        option.value = o.id;
        option.textContent = o.name;
        return option;
      }),
    );
    const selected = orgs.some((o) => o.id === s.orgId) ? s.orgId : me.activeOrganizationId;
    orgSelect.value = selected;
    await chrome.storage.local.set({ orgId: selected });
    orgField.style.display = orgs.length > 1 ? "grid" : "none";
    orgOnly.style.display = orgs.length === 1 ? "block" : "none";
    if (orgs.length === 1) orgOnly.textContent = `Organización: ${orgs[0].name}`;
    orgSelect.dataset.loaded = token;
  } catch {
    /* sin conexión: se usa la organización recordada / la activa del CRM */
  }
}
orgSelect.addEventListener("change", () => chrome.storage.local.set({ orgId: orgSelect.value }));

async function showRecordBox(token) {
  recordBox.style.display = "grid";
  if (recordBox.dataset.url !== meetingUrl) {
    // Reunión distinta: se recupera lo escrito para ESA reunión y se vuelve a habilitar el botón.
    recordBox.dataset.url = meetingUrl;
    const draftKey = `titleDraft:${meetingUrl}`;
    titleInput.value = (await chrome.storage.local.get([draftKey]))[draftKey] || "";
    recordBtn.disabled = false;
    recordStatus.textContent = "";
  }
  await loadOrgs(token);
}
titleInput.addEventListener("input", () => meetingUrl && chrome.storage.local.set({ [`titleDraft:${meetingUrl}`]: titleInput.value }));

const currentTitle = () => titleInput.value.replace(/\s+/g, " ").trim() || null;
const currentOrg = () => (orgField.style.display === "none" ? null : orgSelect.value);

// Grabar: subtítulos (la pestaña de Meet) + audio (coordinador). Si el audio no arranca, los subtítulos siguen igual.
recordBtn.addEventListener("click", () => {
  if (tabId == null || !meetingUrl) return;
  recordBtn.disabled = true;
  setTimeout(() => (recordBtn.disabled = false), 8000); // si algo falló, se puede volver a intentar
  recordStatus.textContent = "Iniciando…";
  const organizationId = currentOrg();
  const title = currentTitle();
  chrome.tabs.sendMessage(tabId, { type: "START_RECORDING", organizationId, title }).catch(() => {
    recordStatus.textContent = "No se pudo conectar con la reunión: recarga la pestaña de Meet e inténtalo de nuevo.";
  });
  chrome.runtime
    .sendMessage({ type: "START_AUDIO_CAPTURE", tabId, meetingUrl, organizationId, title })
    .then((response) => {
      if (response && response.ok === false) recordStatus.textContent = "Audio: " + friendlyAudioError(String(response.error || "no se pudo activar"));
    })
    .catch(() => {});
  void askMic(false); // si falta el permiso del micrófono, Chrome lo pide ahora mismo
});

joinBtn.addEventListener("click", async () => {
  if (!meetingUrl) return;
  joinBtn.disabled = true;
  recordStatus.textContent = "Avisando al asistente…";
  try {
    const s = await chrome.storage.local.get(["token", "apiBase"]);
    const base = (s.apiBase || CRM_BASE).replace(/\/$/, "");
    const res = await fetch(`${base}/api/extension/join-bot`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ meetingUrl, organizationId: currentOrg() || undefined, title: currentTitle() || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudo avisar al asistente.");
    recordStatus.textContent = "Asistente avisado: va a pedir unirse en un momento; admítelo desde Meet.";
  } catch (error) {
    recordStatus.textContent = error && error.message ? error.message : "No se pudo conectar con el CRM.";
    joinBtn.disabled = false;
  }
});

loginBtn.addEventListener("click", () => chrome.tabs.create({ url: `${CRM_BASE}/dashboard/extension-authorize` }));
logoutBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove(["token", "userName", "orgList", "activeOrganizationId"]);
  orgSelect.dataset.loaded = "";
  void render();
});

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
    : "Para ver los nombres de tus micrófonos, permite el micrófono cuando Chrome lo pida al grabar (una sola vez).";
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
const debugBox = $("debugBox");
async function renderDebug() {
  const { debug = [], ...rest } = await chrome.storage.session.get("debug");
  const state = tabId != null ? (await chrome.storage.session.get("live:" + tabId))["live:" + tabId] : null;
  const head = `extensión v${chrome.runtime.getManifest().version} · pestaña ${tabId}\nestado: ${JSON.stringify(state ? { ...state, last: undefined } : null)}\n---\n`;
  debugBox.value = head + debug.map((d) => `${d.t} ${d.text}`).join("\n");
  void rest;
}
$("copyDebug").addEventListener("click", async () => {
  await navigator.clipboard.writeText(debugBox.value);
  $("copyDebug").textContent = "¡Copiado!";
  setTimeout(() => ($("copyDebug").textContent = "Copiar diagnóstico"), 1800);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") {
    void render();
    void renderDebug();
  }
  // La sesión del CRM la guarda la página del CRM al conectarte: el panel se actualiza solo.
  if (area === "local" && (changes.token || changes.userName)) void render();
});
if (!detached) {
  chrome.tabs.onActivated.addListener(() => void render());
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.url || info.status === "complete") void render();
  });
}
void loadSettings();
void render().then(renderDebug);
