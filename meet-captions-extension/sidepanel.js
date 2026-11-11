// Panel del asistente (lateral y ventana separada). Aquí está TODO: iniciar sesión, elegir organización y nombre, grabar,
// ver los subtítulos en vivo, pausar, detener y enviar, vincular la reunión a un cliente y los ajustes. Se abre con el ícono
// de la extensión. Lee el estado en vivo que guarda background.js (chrome.storage.session); los ajustes van en storage.local.
const MEETING_URL_RE = /^https:\/\/meet\.google\.com\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
const CRM_BASE = "https://chats.proshop.lat";
const params = new URLSearchParams(location.search);
const detached = params.get("detached") === "1";
let tabId = params.get("tab") ? Number(params.get("tab")) : null;
let meetingUrl = null;
let lastState = null;
let invokedCache = false; // ¿se hizo clic en el ícono en esta pestaña? (entonces la captura automática funciona)
let audioMethod = "auto"; // «auto» (tabCapture) o «picker» (selector de pestañas de Chrome); se lee al abrir y al cambiarlo

const $ = (id) => document.getElementById(id);
const dot = $("dot");
const subtitle = $("subtitle");
const dest = $("dest");
const consentBox = $("consentBox");
const consentCheck = $("consentCheck");
const consentAccept = $("consentAccept");
const consentLine = $("consentLine");
const consentReset = $("consentReset");
const chips = $("chips");
const notices = $("notices");
const captions = $("captions");
const stopBtn = $("stopBtn");
const pauseBtn = $("pauseBtn");
const detachBtn = $("detachBtn");
const accountBox = $("accountBox");
const loginBtn = $("loginBtn");
const logoutBtn = $("logoutBtn");
const accountLine = $("accountLine");
const recordBox = $("recordBox");
const titleInput = $("titleInput");
const orgField = $("orgField");
const orgSelect = $("orgSelect");
const orgOnly = $("orgOnly");
const recordBtn = $("recordBtn");
const joinBtn = $("joinBtn");
const recordStatus = $("recordStatus");
const doneBox = $("doneBox");
const doneSummary = $("doneSummary");
const crmLink = $("crmLink");
const clientSearch = $("clientSearch");
const results = $("results");
const newClient = $("newClient");
const newToggle = $("newToggle");
const classifyStatus = $("classifyStatus");
const hideToggle = $("hideToggle");
const autoOpenToggle = $("autoOpenToggle");
const recordMicToggle = $("recordMicToggle");
const langSelect = $("langSelect");
const audioMethodSelect = $("audioMethodSelect");
const micSelect = $("micSelect");
const micHint = $("micHint");
const settings = $("settings");
$("ver").textContent = "ProShop CRM · extensión v" + chrome.runtime.getManifest().version;
crmLink.href = `${CRM_BASE}/dashboard/reuniones`;
if (detached) detachBtn.style.display = "none";

// ───────── Consentimiento (aviso dentro de la extensión, antes de pedir nada) ─────────
// Se muestra la primera vez y cada vez que cambie su texto (sube CONSENT_VERSION). Hasta aceptarlo no se pide el micrófono, ni la
// sesión, ni se puede grabar.
const CONSENT_VERSION = 1;
async function getConsent() {
  const { consent } = await chrome.storage.local.get(["consent"]);
  return consent && consent.version >= CONSENT_VERSION ? consent : null;
}
consentCheck.addEventListener("change", () => (consentAccept.disabled = !consentCheck.checked));
consentAccept.addEventListener("click", async () => {
  await chrome.storage.local.set({ consent: { version: CONSENT_VERSION, at: Date.now() } });
  consentCheck.checked = false;
  consentAccept.disabled = true;
});
consentReset.addEventListener("click", async () => {
  if (lastState && lastState.recording) return; // no se puede quitar el aviso en medio de una grabación
  await chrome.storage.local.remove(["consent"]);
});

// ───────── Utilidades ─────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clock = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(s).padStart(2, "0")}`;
};

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
function friendlyAudioError(message) {
  if (/invoked|activeTab|not been invoked/i.test(message)) {
    return "Chrome no dejó capturar el audio de esta pestaña. Haz clic en el ícono de la extensión (barra de Chrome) para abrir el panel desde ahí, y vuelve a pulsar «Grabar».";
  }
  return message;
}
async function apiBase() {
  const { apiBase: stored } = await chrome.storage.local.get(["apiBase"]);
  return (stored || CRM_BASE).replace(/\/$/, "");
}

// ───────── Micrófono: el permiso se pide desde aquí (página visible) ─────────
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
  return result;
}

// ───────── A qué organización va la reunión ─────────
async function renderDest(state, future) {
  const s = await chrome.storage.local.get(["orgList", "activeOrganizationId", "token"]);
  let list = s.orgList;
  let active = s.activeOrganizationId;
  if (!list && s.token) {
    try {
      const res = await fetch(`${await apiBase()}/api/extension/me`, { headers: { Authorization: `Bearer ${s.token}` } });
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

// ───────── Cuenta ─────────
function renderAccount(auth) {
  accountBox.style.display = auth.token ? "none" : "grid";
  accountLine.textContent = auth.token ? "Conectado" + (auth.userName ? " como " + auth.userName : "") : "Sin conectar";
  logoutBtn.style.display = auth.token ? "inline" : "none";
}

// Un solo clic: pide el permiso del micrófono (aviso de Chrome) y, enseguida, abre el CRM para iniciar sesión.
loginBtn.addEventListener("click", async () => {
  loginBtn.disabled = true;
  loginBtn.textContent = "Permite el micrófono en el aviso de Chrome…";
  await Promise.race([ensureMicPermission(), sleep(20000)]); // si no contesta, igual se sigue
  chrome.tabs.create({ url: `${CRM_BASE}/dashboard/extension-authorize` });
  loginBtn.textContent = "Iniciar sesión y permitir el micrófono";
  loginBtn.disabled = false;
});
logoutBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove(["token", "userName", "orgList", "activeOrganizationId"]);
  orgSelect.dataset.loaded = "";
  void render();
});

// ───────── Organización y nombre (antes de grabar) ─────────
async function loadOrgs(token) {
  if (orgSelect.dataset.loaded === token) return;
  try {
    const s = await chrome.storage.local.get(["orgId"]);
    const res = await fetch(`${await apiBase()}/api/extension/me`, { headers: { Authorization: `Bearer ${token}` } });
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

async function showRecordBox(token, { fresh } = {}) {
  recordBox.style.display = "grid";
  const key = meetingUrl + (fresh ? "|" + fresh : "");
  if (recordBox.dataset.key !== key) {
    // Reunión distinta (o una grabación nueva): se recupera lo escrito para ESA reunión y se vuelve a habilitar el botón.
    recordBox.dataset.key = key;
    const draftKey = `titleDraft:${meetingUrl}`;
    titleInput.value = fresh ? "" : (await chrome.storage.local.get([draftKey]))[draftKey] || "";
    if (fresh) chrome.storage.local.remove(draftKey);
    recordBtn.disabled = false;
    recordBtn.textContent = fresh ? "Grabar otra reunión" : "Grabar esta reunión";
    recordStatus.textContent = "";
  }
  await loadOrgs(token);
}
titleInput.addEventListener("input", () => meetingUrl && chrome.storage.local.set({ [`titleDraft:${meetingUrl}`]: titleInput.value }));
const currentTitle = () => titleInput.value.replace(/\s+/g, " ").trim() || null;
const currentOrg = () => (orgField.style.display === "none" ? null : orgSelect.value);

// Grabar: subtítulos (pestaña de Meet) + audio (coordinador). Cada vez es una grabación nueva con su propio id: la del cliente
// y la del equipo en la misma sala quedan como reuniones separadas. Si el audio no arranca, los subtítulos siguen igual.
recordBtn.addEventListener("click", () => {
  if (tabId == null || !meetingUrl) return;
  recordBtn.disabled = true;
  setTimeout(() => (recordBtn.disabled = false), 8000); // si algo falló, se puede volver a intentar
  recordStatus.textContent = "Iniciando…";
  const organizationId = currentOrg();
  const title = currentTitle();
  const recordingId = crypto.randomUUID();
  chrome.tabs
    .sendMessage(tabId, { type: "START_RECORDING", organizationId, title, recordingId })
    .then((response) => {
      if (response && response.ok === false) recordStatus.textContent = response.error || "No se pudo empezar a grabar.";
    })
    .catch(() => {
      recordStatus.textContent = "No se pudo conectar con la reunión: recarga la pestaña de Meet e inténtalo de nuevo.";
    });
  startAudio({ organizationId, title, recordingId });
  void askMic(false); // si falta el permiso del micrófono, Chrome lo pide ahora mismo
});

// ───────── Audio de la reunión: dos formas de capturar la pestaña ─────────
// Automático: Chrome da la captura de la pestaña si la extensión se abrió con su ícono (permiso activeTab). Si Chrome no la da
// (se abrió con el botón de la pantalla de Meet, o el permiso no se mantuvo), queda el plan B: el selector de pestañas de Chrome,
// que no depende de ese permiso. El permiso de «captura de pantalla» es OPCIONAL: solo se pide si se usa el selector.
function startAudio({ organizationId, title, recordingId }) {
  // Sin el clic en el ícono Chrome no deja la captura automática: se va directo al selector de pestañas (este clic todavía vale).
  if (audioMethod === "picker" || !invokedCache) return pickAudio({ organizationId, title, recordingId });
  return chrome.runtime
    .sendMessage({ type: "START_AUDIO_CAPTURE", tabId, meetingUrl, organizationId, title, recordingId })
    .then((response) => {
      if (response && response.ok === false) recordStatus.textContent = "Audio: " + friendlyAudioError(String(response.error || "no se pudo activar"));
    })
    .catch(() => {});
}

// Debe llamarse directo desde un clic (el permiso opcional lo exige).
function pickAudio({ organizationId, title, recordingId }) {
  recordStatus.textContent = "Elige la pestaña de Meet y marca «Compartir audio de la pestaña»…";
  return chrome.permissions
    .request({ permissions: ["desktopCapture"] })
    .then((granted) => {
      if (!granted) {
        recordStatus.textContent = "Sin ese permiso no se puede usar el selector: se graban solo los subtítulos.";
        return;
      }
      chrome.desktopCapture.chooseDesktopMedia(["tab", "audio"], (streamId, options) => {
        if (!streamId) {
          recordStatus.textContent = "No elegiste ninguna pestaña: se graban solo los subtítulos.";
          return;
        }
        if (options && options.canRequestAudioTrack === false) {
          recordStatus.textContent = "Marca «Compartir audio de la pestaña» en el selector de Chrome.";
          return;
        }
        chrome.runtime
          .sendMessage({ type: "START_AUDIO_CAPTURE", tabId, meetingUrl: (lastState && lastState.meetingUrl) || meetingUrl, organizationId, title, recordingId, streamId })
          .then((response) => {
            recordStatus.textContent = response && response.ok === false ? "Audio: " + String(response.error || "no se pudo activar") : "";
          })
          .catch(() => {});
      });
    })
    .catch(() => {
      recordStatus.textContent = "No se pudo abrir el selector de pestañas.";
    });
}

joinBtn.addEventListener("click", async () => {
  if (!meetingUrl) return;
  joinBtn.disabled = true;
  recordStatus.textContent = "Avisando al asistente…";
  try {
    const { token } = await chrome.storage.local.get(["token"]);
    const res = await fetch(`${await apiBase()}/api/extension/join-bot`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

// ───────── Reunión terminada: a qué cliente fue ─────────
let searchTimer = null;
clientSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = clientSearch.value.trim();
  results.replaceChildren();
  if (q.length < 2) return;
  searchTimer = setTimeout(async () => {
    const { token } = await chrome.storage.local.get(["token"]);
    if (!token) return;
    const orgId = lastState && lastState.organizationId;
    try {
      const res = await fetch(`${await apiBase()}/api/extension/opportunities/search?q=${encodeURIComponent(q)}${orgId ? `&organizationId=${encodeURIComponent(orgId)}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      results.replaceChildren(
        ...(data.results || []).map((r) => {
          const b = document.createElement("button");
          b.textContent = `${r.title} — ${r.contactName}`;
          b.addEventListener("click", () => void classify({ opportunityId: r.id }, r.title));
          return b;
        }),
      );
      if (!data.results || data.results.length === 0) classifyStatus.textContent = "No hay clientes con ese nombre: puedes crear uno nuevo.";
      else classifyStatus.textContent = "";
    } catch {
      classifyStatus.textContent = "No se pudo buscar ahora. Inténtalo de nuevo.";
    }
  }, 300);
});
newToggle.addEventListener("click", () => {
  newClient.style.display = newClient.style.display === "none" ? "grid" : "none";
});
$("newSave").addEventListener("click", () => {
  const name = $("newName").value.trim();
  const phone = $("newPhone").value.trim();
  if (!phone) {
    classifyStatus.textContent = "Falta el teléfono del cliente.";
    return;
  }
  void classify({ newContactName: name, newContactPhone: phone, newOpportunityTitle: name }, name || phone);
});
async function classify(extra, label) {
  const { token } = await chrome.storage.local.get(["token"]);
  if (!token || !lastState) return;
  classifyStatus.textContent = "Vinculando…";
  try {
    const res = await fetch(`${await apiBase()}/api/extension/meetings/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ meetingUrl: lastState.meetingUrl, recordingId: lastState.recordingId, ...(lastState.organizationId ? { organizationId: lastState.organizationId } : {}), ...extra }),
    });
    if (!res.ok) throw new Error(await res.text());
    classifyStatus.textContent = `✓ Reunión vinculada a «${label}».`;
    results.replaceChildren();
    clientSearch.value = "";
    newClient.style.display = "none";
  } catch {
    classifyStatus.textContent = "No se pudo vincular. Inténtalo de nuevo.";
  }
}

function showDoneBox(state) {
  doneBox.style.display = "grid";
  const audio = state.audio || {};
  const parts = [];
  if (state.startedAt && state.endedAt) parts.push(`Duración ${clock(state.endedAt - state.startedAt)}`);
  parts.push(`${state.lines || 0} líneas de subtítulos`);
  if (audio.part) parts.push(`${audio.uploaded || 0} de ${audio.part} parte(s) de audio subidas`);
  doneSummary.textContent = parts.join(" · ") + (state.title ? ` · ${state.title}` : "");
  if (doneBox.dataset.rec !== String(state.recordingId)) {
    // Grabación distinta a la que se estaba mostrando: se limpia la vinculación anterior.
    doneBox.dataset.rec = String(state.recordingId);
    classifyStatus.textContent = "";
    clientSearch.value = "";
    results.replaceChildren();
    newClient.style.display = "none";
  }
}

// ───────── Pantalla ─────────
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

// Cronómetro de la grabación en curso (se actualiza solo cada segundo, sin redibujar todo).
let clockTimer = null;
function paintHeaderStatus() {
  const s = lastState;
  if (!s || !s.recording || !s.startedAt) return;
  subtitle.textContent = "";
  const label = document.createTextNode(s.paused ? "Grabación en pausa · " : "Grabando · ");
  const time = document.createElement("span");
  time.id = "clock";
  time.textContent = clock(Date.now() - s.startedAt);
  subtitle.append(label, time);
}

function hideAllBoxes() {
  recordBox.style.display = "none";
  doneBox.style.display = "none";
  consentBox.style.display = "none";
}

async function render() {
  const tab = await resolveTab();
  const auth = await chrome.storage.local.get(["token", "userName"]);
  const consent = await getConsent();
  hideAllBoxes();
  chips.replaceChildren();
  notices.replaceChildren();
  stopBtn.disabled = true;
  pauseBtn.disabled = true;
  pauseBtn.textContent = "Pausar";
  consentLine.textContent = consent ? `Aviso de consentimiento aceptado el ${new Date(consent.at).toLocaleDateString("es")}` : "";
  consentReset.style.display = consent ? "inline" : "none";

  // Sin aceptar el aviso no se muestra nada más: ni sesión, ni micrófono, ni grabar.
  if (!consent) {
    accountBox.style.display = "none";
    consentBox.style.display = "grid";
    dot.className = "dot";
    subtitle.textContent = "Antes de empezar";
    dest.textContent = "";
    renderCaptions([]);
    return;
  }
  renderAccount(auth);

  if (!tab || !tab.url || !MEETING_URL_RE.test(tab.url)) {
    dot.className = "dot";
    subtitle.textContent = "Asistente de reuniones";
    dest.textContent = "";
    if (auth.token) notices.append(notice("Abre una reunión de Google Meet para grabarla.", "info"));
    renderCaptions([]);
    return;
  }
  tabId = tab.id;
  meetingUrl = `https://meet.google.com/${tab.url.match(MEETING_URL_RE)[1].toLowerCase()}`;
  invokedCache = Boolean((await chrome.runtime.sendMessage({ type: "IS_INVOKED", tabId }).catch(() => null))?.invoked);
  const key = "live:" + tab.id;
  const stored = await chrome.storage.session.get(key);
  const state = stored[key];
  lastState = state || null;
  const recording = Boolean(state && state.recording);
  const stopped = Boolean(state && state.stopped && !state.recording);
  await renderDest(state, !recording && !stopped);

  if (!auth.token) {
    dot.className = "dot";
    subtitle.textContent = "Reunión detectada";
    renderCaptions([]);
    return;
  }

  // Sin grabar, o ya terminada: se puede empezar una grabación (nueva) desde aquí mismo.
  if (!recording) {
    dot.className = "dot" + (stopped ? " done" : "");
    subtitle.textContent = stopped ? "Grabación terminada" : "Reunión detectada";
    if (stopped) showDoneBox(state);
    void showRecordBox(auth.token, { fresh: stopped ? state.recordingId : null });
    renderCaptions(stopped ? state.last : []);
    return;
  }

  const audio = state.audio || {};
  const paused = Boolean(state.paused);
  dot.className = "dot" + (paused ? " pause" : " rec");
  paintHeaderStatus();
  stopBtn.disabled = false;
  pauseBtn.disabled = false;
  pauseBtn.textContent = paused ? "Reanudar" : "Pausar";

  if (paused) chips.append(chip("En pausa: no se guarda nada", "warn"));
  chips.append(chip(`Subtítulos: ${state.lines || 0} líneas`, state.lines ? "ok" : ""));
  if (audio.active) chips.append(chip(`Audio: ${paused ? "en pausa" : "grabando"} · ${audio.uploaded || 0} partes enviadas`, paused ? "warn" : "ok"));
  else if (audio.starting) chips.append(chip("Audio: iniciando…"));
  else if (audio.lastError || audio.failed) chips.append(chip("Audio: con problemas", "bad"));
  else chips.append(chip("Audio: sin grabar"));
  if (audio.active && audio.micAvailable) {
    const name = audio.micLabel ? ` (${audio.micLabel.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "")})` : "";
    chips.append(chip(state.micMuted ? "Micrófono: silenciado, no se graba" : "Micrófono: grabando" + name, state.micMuted ? "warn" : ""));
  } else if (audio.active && audio.micState === "off") {
    chips.append(chip("Micrófono: apagado en Ajustes"));
  }

  if (state.warning) notices.append(notice(state.warning, "warn"));
  if (audio.active && audio.micState && audio.micState !== "ok" && audio.micState !== "off") {
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
      void askMic(false); // Chrome muestra el aviso «quiere usar tu micrófono» solo
    }
  }
  const pickerArgs = { organizationId: state.organizationId, title: state.title, recordingId: state.recordingId };
  const askPicker = () => void pickAudio(pickerArgs);
  if (audio.lastError) {
    const needsPicker = /invoked|activeTab|not been invoked|Chrome no dejó/i.test(audio.lastError);
    notices.append(notice("Audio: " + friendlyAudioError(audio.lastError), "error", needsPicker ? "Elegir la pestaña de Meet (audio)" : undefined, askPicker));
  }
  if (audio.failed) notices.append(notice(`${audio.failed} parte(s) del audio no se pudieron subir (se reintenta cada minuto).`, "error"));
  if (!audio.active && !audio.starting && audio.part === undefined && !audio.lastError && Date.now() - (state.startedAt || 0) > 6000) {
    notices.append(notice("El audio no está grabando. Puedes elegir la pestaña de Meet con el selector de Chrome, o abrir el panel con el ícono de la extensión, detener y volver a grabar.", "warn", "Elegir la pestaña de Meet (audio)", askPicker));
  }

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
  const s = await chrome.storage.local.get(["hideMeetCaptions", "autoOpenWindow", "captionLang", "micDeviceId", "recordMic", "audioMethod"]);
  audioMethod = s.audioMethod === "picker" ? "picker" : "auto";
  audioMethodSelect.value = audioMethod;
  hideToggle.checked = s.hideMeetCaptions !== false;
  autoOpenToggle.checked = Boolean(s.autoOpenWindow);
  recordMicToggle.checked = s.recordMic !== false;
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
recordMicToggle.addEventListener("change", () => chrome.storage.local.set({ recordMic: recordMicToggle.checked }));
langSelect.addEventListener("change", () => chrome.storage.local.set({ captionLang: langSelect.value }));
audioMethodSelect.addEventListener("change", () => {
  audioMethod = audioMethodSelect.value === "picker" ? "picker" : "auto";
  chrome.storage.local.set({ audioMethod });
});

// Micrófonos: la lista sale del navegador; los nombres solo aparecen si el permiso ya se concedió.
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
    : "Para ver los nombres de tus micrófonos, permite el micrófono cuando Chrome lo pida (una sola vez).";
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

// ───────── Diagnóstico ─────────
const debugBox = $("debugBox");
async function renderDebug() {
  const { debug = [] } = await chrome.storage.session.get("debug");
  const state = tabId != null ? (await chrome.storage.session.get("live:" + tabId))["live:" + tabId] : null;
  const head = `extensión v${chrome.runtime.getManifest().version} · pestaña ${tabId}\nestado: ${JSON.stringify(state ? { ...state, last: undefined } : null)}\n---\n`;
  debugBox.value = head + debug.map((d) => `${d.t} ${d.text}`).join("\n");
}
$("copyDebug").addEventListener("click", async () => {
  await navigator.clipboard.writeText(debugBox.value);
  $("copyDebug").textContent = "¡Copiado!";
  setTimeout(() => ($("copyDebug").textContent = "Copiar diagnóstico"), 1800);
});

// ───────── Arranque ─────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") {
    void render();
    void renderDebug();
  }
  // La sesión del CRM la guarda la página del CRM al conectarte: el panel se actualiza solo y, si falta, pide el micrófono.
  if (area === "local" && changes.consent) void render();
  if (area === "local" && (changes.token || changes.userName)) {
    void render();
    if (changes.token && changes.token.newValue && !micPromptTried) {
      micPromptTried = true;
      void askMic(false);
    }
  }
});
if (!detached) {
  chrome.tabs.onActivated.addListener(() => void render());
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.url || info.status === "complete") void render();
  });
}
clockTimer = setInterval(paintHeaderStatus, 1000);
void clockTimer;
void loadSettings();
void render().then(renderDebug);
