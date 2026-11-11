// Extensión ProShop CRM — script de la pestaña de Meet.
//
// Corre dentro del navegador de quien está en la reunión, como un participante más (no hay bot aparte): lee los subtítulos
// de Meet ("Nombre: lo que dijo"), vigila si tu micrófono está silenciado (para que tu voz no se grabe mientras lo estás),
// detecta el fin de la reunión y manda todo al CRM. Cada vez que se pulsa «Grabar» es UNA grabación con su propio id: se
// puede detener y empezar otra en la misma sala (primero el cliente, después el equipo) y quedan como reuniones separadas.
(function () {
  "use strict";

  // Meet usa tanto /abc-defg-hij como /meet/abc-defg-hij (el que sale al abrir el link desde Calendar o Gmail).
  const MEETING_CODE_RE = /^\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/i;
  const POLL_MS = 2000;
  const END_CHECK_TICKS = 10; // cada 10 polls (~20 s) se fija si la reunión terminó
  const API_PATH = "/api/extension/transcript";

  // ───────── Contexto de la extensión ─────────
  // Si la extensión se recarga o se actualiza mientras esta pestaña sigue abierta, este script queda "huérfano": cada llamada
  // a chrome.* lanza «Extension context invalidated». Todo pasa por estas funciones y, al detectarlo, se apaga limpio
  // (sin errores en la consola, sin dejar botones colgados). La pestaña nueva/recargada ya carga el script actualizado.
  let dead = false;
  const alive = () => {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  };
  const intervals = [];
  const observers = [];
  let launcherEl = null;
  let badgeEl = null;
  function every(fn, ms) {
    const id = setInterval(() => {
      if (dead) return;
      if (!alive()) return shutdown();
      try {
        fn();
      } catch (error) {
        if (!alive()) shutdown();
        else console.error("[proshop-captions]", error);
      }
    }, ms);
    intervals.push(id);
    return id;
  }
  function shutdown() {
    if (dead) return;
    dead = true;
    for (const id of intervals) clearInterval(id);
    for (const o of observers) o.disconnect();
    for (const el of [launcherEl, badgeEl]) if (el) el.remove();
    launcherEl = badgeEl = null;
    try {
      if (window.ProShopCaptions) window.ProShopCaptions.setHidden(false); // deja la pantalla de Meet como estaba
    } catch {
      /* nada más que hacer */
    }
  }
  function send(message) {
    if (dead || !alive()) return Promise.resolve(undefined);
    try {
      return Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => undefined);
    } catch {
      return Promise.resolve(undefined);
    }
  }
  function store(keys) {
    if (dead || !alive()) return Promise.resolve({});
    try {
      return Promise.resolve(chrome.storage.local.get(keys)).catch(() => ({}));
    } catch {
      return Promise.resolve({});
    }
  }
  const dbg = (text) => void send({ type: "DEBUG", text: "[página] " + text });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ───────── Estado de la grabación ─────────
  // Meet es una SPA: se pasa de la pantalla de inicio a una reunión SIN recargar la página, así que la reunión se mira de
  // nuevo cada segundo. Mientras se graba, el enlace queda fijo. Siempre el link canónico: la misma reunión cae en la
  // misma fila del CRM sin importar cómo se abrió.
  let meetingUrl = null;
  let phase = "idle"; // idle → recording → stopped (y de stopped se puede volver a grabar)
  let recordingId = null;
  let startedAt = null;
  let endedAt = null;
  let ticks = 0;
  let consecutiveEndSignals = 0;
  let sent = false;
  let paused = false; // en pausa: no se guarda nada hasta reanudar
  let warning = null; // aviso visible en el panel (subtítulos que no se activaron, no llegan…)
  let noCaptionsWarned = false;
  let timer = null;
  let pending = null;
  let maxParticipantsSeen = 0;
  let lockedOrgId; // organización de ESTA grabación (se fija al pulsar «Grabar»); sin elegir va null
  let lockedTitle = null; // nombre de la reunión (opcional), fijado al pulsar «Grabar»
  const finalizedKeys = new Set();
  const finalizedLines = [];

  const isRecording = () => phase === "recording";

  function syncMeetingUrl() {
    if (isRecording()) return;
    const match = MEETING_CODE_RE.exec(window.location.pathname);
    meetingUrl = match ? `https://meet.google.com/${match[1].toLowerCase()}` : null;
  }
  syncMeetingUrl();
  every(syncMeetingUrl, 1000);

  // Empieza de cero para una grabación nueva (la anterior ya se envió).
  function resetSession() {
    clearInterval(timer);
    timer = null;
    phase = "idle";
    recordingId = null;
    startedAt = endedAt = null;
    ticks = 0;
    consecutiveEndSignals = 0;
    sent = false;
    paused = false;
    warning = null;
    noCaptionsWarned = false;
    pending = null;
    maxParticipantsSeen = 0;
    lockedOrgId = undefined;
    lockedTitle = null;
    finalizedKeys.clear();
    finalizedLines.length = 0;
  }

  let lastMicMuted = null;

  // Estado en vivo para el panel (el service worker lo guarda).
  function pushLive() {
    const lines = [...finalizedLines];
    if (pending && pending.text) lines.push(`${pending.name}: ${pending.text}`);
    void send({
      type: "LIVE_STATE",
      state: {
        meetingUrl,
        recording: isRecording(),
        stopped: phase === "stopped",
        paused,
        recordingId,
        startedAt,
        endedAt,
        lines: finalizedLines.length + (pending && pending.text ? 1 : 0),
        organizationId: lockedOrgId === undefined ? null : lockedOrgId,
        title: lockedTitle,
        last: lines.slice(-60),
        warning,
        micMuted: lastMicMuted === true,
        hideMeetCaptions: window.ProShopCaptions ? window.ProShopCaptions.isHidden() : true,
      },
    });
  }

  function recordIfNew(name, text) {
    const key = `${name}:${text}`;
    if (text && !finalizedKeys.has(key)) {
      finalizedKeys.add(key);
      finalizedLines.push(`${name}: ${text}`);
    }
  }
  function currentTranscript() {
    const lines = [...finalizedLines];
    if (pending && pending.text) lines.push(`${pending.name}: ${pending.text}`);
    return lines.join("\n");
  }

  // ───────── Botón de la extensión en la pantalla de la reunión (con el logo del CRM) ─────────
  async function syncLauncher() {
    // Solo aparece con la sesión iniciada y el aviso de consentimiento aceptado: antes no hay nada que hacer desde aquí.
    const { token, consent } = await store(["token", "consent"]);
    if (!meetingUrl || !token || !consent || dead) {
      if (launcherEl) launcherEl.remove();
      launcherEl = null;
      return;
    }
    if (!launcherEl || !launcherEl.isConnected) {
      launcherEl = document.createElement("button");
      launcherEl.id = "proshop-launcher";
      launcherEl.type = "button";
      launcherEl.title = "ProShop CRM — abrir el asistente de la reunión";
      launcherEl.setAttribute("aria-label", "ProShop CRM: abrir el asistente de la reunión");
      launcherEl.style.cssText =
        "position:fixed;bottom:72px;left:16px;z-index:999998;width:44px;height:44px;padding:0;border:0;border-radius:12px;" +
        "background:none;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.4);";
      const logo = document.createElement("img");
      logo.src = chrome.runtime.getURL("icons/icon48.png");
      logo.alt = "";
      logo.style.cssText = "display:block;width:44px;height:44px;border-radius:12px;";
      const dot = document.createElement("span");
      dot.id = "proshop-launcher-rec";
      dot.style.cssText =
        "position:absolute;top:-4px;right:-4px;width:12px;height:12px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none;";
      launcherEl.append(logo, dot);
      launcherEl.addEventListener("click", () => void send({ type: "OPEN_PANEL" }));
      document.body.appendChild(launcherEl);
    }
    const dot = launcherEl.querySelector("#proshop-launcher-rec");
    if (dot) dot.style.display = isRecording() ? "block" : "none";
  }
  every(() => void syncLauncher(), 1000);

  // ───────── Indicador de grabación (visible para quien graba, como cualquier notetaker) ─────────
  const clock = (ms) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(s).padStart(2, "0")}`;
  };
  function syncBadge() {
    if (!isRecording()) {
      if (badgeEl) badgeEl.remove();
      badgeEl = null;
      return;
    }
    if (!badgeEl || !badgeEl.isConnected) {
      badgeEl = document.createElement("div");
      badgeEl.id = "proshop-captions-badge";
      badgeEl.style.cssText =
        "position:fixed;bottom:16px;left:16px;z-index:999999;background:#111827;color:#fff;font:12px/1.4 system-ui,sans-serif;" +
        "padding:8px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;gap:8px;pointer-events:none;";
      const dot = document.createElement("span");
      dot.id = "proshop-badge-dot";
      dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0;";
      const label = document.createElement("span");
      label.id = "proshop-captions-label";
      badgeEl.append(dot, label);
      document.body.appendChild(badgeEl);
    }
    const label = badgeEl.querySelector("#proshop-captions-label");
    const dot = badgeEl.querySelector("#proshop-badge-dot");
    if (label) label.textContent = `ProShop CRM · ${paused ? "en pausa" : "grabando"} ${clock(Date.now() - startedAt)}`;
    if (dot) dot.style.background = paused ? "#f59e0b" : "#ef4444";
  }
  every(syncBadge, 1000);

  // ───────── Utilidades de la pantalla de Meet ─────────
  // Encontrar botones por su nombre accesible, sin depender de las clases internas de Meet (que cambian con rediseños).
  function findButtonByName(regex) {
    for (const el of document.querySelectorAll('[role="button"], button')) {
      const name = (el.getAttribute("aria-label") || el.textContent || "").trim();
      if (regex.test(name)) return el;
    }
    return null;
  }

  // ───────── Micrófono silenciado ─────────
  // Silenciar en Meet solo corta lo que se manda a los demás: la grabación abre el micrófono aparte. Por eso se vigila el
  // botón de Meet (data-is-muted; de respaldo su texto) y se le avisa al grabador, que CORTA tu voz por completo (silencio
  // total, no volumen bajo). Se revisa al instante cuando el botón cambia y cada 250 ms como respaldo: el corte ocurre en
  // menos de un cuarto de segundo, y mientras estás en silencio nada de tu micrófono entra a la grabación.
  function isMicMuted() {
    const el = document.querySelector('[data-is-muted][aria-label*="micrófono" i], [data-is-muted][aria-label*="microphone" i]');
    if (el) return el.getAttribute("data-is-muted") === "true";
    const fallback = findButtonByName(/micrófono|microphone/i);
    if (!fallback) return false; // no se encontró el botón: mejor no cortar el micrófono por las dudas
    return /activar|turn on/i.test((fallback.getAttribute("aria-label") || "").trim());
  }
  function syncMic(force) {
    const muted = isMicMuted();
    if (!force && muted === lastMicMuted) return;
    lastMicMuted = muted;
    void send({ type: "SET_MIC_ENABLED", enabled: !muted });
  }
  every(() => syncMic(false), 250);
  try {
    const muteObserver = new MutationObserver(() => syncMic(false));
    muteObserver.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["data-is-muted"] });
    observers.push(muteObserver);
  } catch {
    /* el sondeo de arriba alcanza */
  }

  // ───────── Subtítulos ─────────
  // Activa los subtítulos (sin apagarlos si ya estaban) y los pone en el idioma elegido en Ajustes.
  async function enableCaptions() {
    const activos = await window.ProShopCaptions.activate();
    if (!activos) return false;
    await sleep(500);
    const { captionLang } = await store(["captionLang"]);
    const lang = captionLang || "es";
    if (lang === "none") return true;
    const langRe = lang === "en" ? /english|inglés/i : /español|spanish/i;
    try {
      const combo = document.querySelector('[role="combobox"][aria-label*="idioma de la reunión" i], [role="combobox"][aria-label*="meeting language" i]');
      if (combo) {
        combo.focus();
        combo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await sleep(500);
        const wanted = [...document.querySelectorAll('[role="option"]')].find((o) => langRe.test(o.textContent || ""));
        if (wanted) {
          wanted.scrollIntoView({ block: "center" });
          wanted.click();
        }
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }
    } catch {
      // Sin cambiar el idioma Meet igual sigue transcribiendo: mejor eso que no tener nada.
    }
    return true;
  }

  function readCaptionsPanel() {
    const region = document.querySelector('[role="region"][aria-label="Subtítulos"], [role="region"][aria-label="Captions"]');
    if (!region) return { blocks: [], fallback: "" };
    const blockEls = Array.from(region.querySelectorAll(".nMcdL"));
    if (blockEls.length > 0) {
      return {
        blocks: blockEls.map((el) => ({
          name: el.querySelector(".NWpY1d")?.textContent?.trim() || "Alguien",
          text: el.querySelector(".ygicle")?.textContent?.trim() || "",
        })),
        fallback: "",
      };
    }
    return { blocks: [], fallback: (region.innerText || "").trim() };
  }

  // «La reunión terminó» solo si ANTES hubo más de una persona y DESPUÉS quedó una (o el botón de personas desapareció):
  // quien prueba solo, sin nadie más, no corta la grabación a los 40 s.
  function meetingLooksOver() {
    const el = findButtonByName(/personas|people/i);
    if (!el) return true;
    const match = (el.textContent || "").match(/\d+/);
    const count = match ? Number(match[0]) : null;
    if (count === null) return false;
    if (count > maxParticipantsSeen) maxParticipantsSeen = count;
    if (maxParticipantsSeen <= 1) return false;
    return count <= 1;
  }

  // ───────── Enviar al CRM ─────────
  async function sendTranscript(reason) {
    if (sent) return;
    const transcript = currentTranscript().trim();
    if (transcript.length < 40) {
      dbg(`no se mandan subtítulos (${reason}): muy cortos (${transcript.length} caracteres, mínimo 40)`);
      return;
    }
    sent = true;
    const { apiBase, token, orgId: storedOrgId } = await store(["apiBase", "token", "orgId"]);
    const orgId = lockedOrgId !== undefined ? lockedOrgId : storedOrgId || null;
    if (!token) {
      sent = false;
      dbg("sin sesión del CRM: no se pudieron mandar los subtítulos");
      return;
    }
    const base = (apiBase || "https://chats.proshop.lat").replace(/\/$/, "");
    try {
      const res = await fetch(base + API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ meetingUrl, transcript, recordingId, ...(orgId ? { organizationId: orgId } : {}), ...(lockedTitle ? { title: lockedTitle } : {}) }),
      });
      dbg(`subtítulos enviados (${reason}): ${res.status}`);
      if (!res.ok) sent = false; // se puede reintentar al detener de nuevo
    } catch (error) {
      sent = false;
      dbg("no se pudieron enviar los subtítulos: " + (error && error.message ? error.message : error));
    }
  }

  // Termina esta grabación: manda los subtítulos, sube la última parte del audio y vuelve a mostrar la franja de Meet.
  // Después se puede empezar otra grabación (la de otro cliente, la del equipo…). Seguro de llamar varias veces.
  async function stopAndSend(reason) {
    if (!isRecording()) return;
    phase = "stopped";
    endedAt = Date.now();
    clearInterval(timer);
    timer = null;
    if (pending) recordIfNew(pending.name, pending.text);
    pending = null;
    pushLive(); // el panel pasa a «terminada» enseguida
    await sendTranscript(reason);
    void send({ type: "STOP_AUDIO_CAPTURE" });
    window.ProShopCaptions.setHidden(false);
    syncBadge();
    pushLive();
  }

  async function tick() {
    if (!isRecording()) return;
    ticks += 1;
    syncMic(true); // reenvía el estado del micrófono: si el grabador arrancó después, igual se entera
    const { blocks, fallback } = readCaptionsPanel();

    if (paused) {
      // En pausa: lo que Meet muestre ahora se marca como ya visto para que NO se guarde al reanudar.
      for (const b of blocks) finalizedKeys.add(`${b.name}:${b.text}`);
      pending = null;
    } else if (blocks.length > 0) {
      for (let i = 0; i < blocks.length - 1; i++) recordIfNew(blocks[i].name, blocks[i].text);
      pending = blocks[blocks.length - 1] || null;
    } else if (fallback && fallback.length >= 25) {
      recordIfNew("", fallback);
    }

    // Vigilante: si llegan subtítulos se quita el aviso; si pasan ~90 s grabando sin ninguna línea, se avisa.
    if (finalizedLines.length > 0 || (pending && pending.text)) {
      if (warning) warning = null;
    } else if (ticks >= 45 && !noCaptionsWarned && !paused) {
      noCaptionsWarned = true;
      warning = "Llevo 1½ minutos sin recibir subtítulos: actívalos en Meet (botón «Subtítulos» o CC) y que alguien hable. El audio sigue grabándose.";
    }
    pushLive();

    if (ticks % END_CHECK_TICKS === 0) {
      if (meetingLooksOver()) {
        consecutiveEndSignals += 1;
        if (consecutiveEndSignals >= 2) void stopAndSend("fin de reunión detectado");
      } else {
        consecutiveEndSignals = 0;
      }
    }
  }

  // Red de seguridad: si se cierra la pestaña sin detectar el fin, sendBeacon manda lo acumulado (no admite headers
  // propios: el token viaja en el cuerpo, que el servidor también acepta).
  window.addEventListener("pagehide", () => {
    if (dead || !alive()) return;
    void send({ type: "STOP_AUDIO_CAPTURE" });
    if (!isRecording() || sent) return;
    const transcript = currentTranscript().trim();
    if (transcript.length < 40) return;
    try {
      chrome.storage.local.get(["apiBase", "token", "orgId"], ({ apiBase, token, orgId: storedOrgId }) => {
        if (!token) return;
        const orgId = lockedOrgId !== undefined ? lockedOrgId : storedOrgId || null;
        const base = (apiBase || "https://chats.proshop.lat").replace(/\/$/, "");
        const blob = new Blob(
          [JSON.stringify({ meetingUrl, transcript, token, recordingId, ...(orgId ? { organizationId: orgId } : {}), ...(lockedTitle ? { title: lockedTitle } : {}) })],
          { type: "application/json" },
        );
        navigator.sendBeacon(base + API_PATH, blob);
      });
    } catch {
      /* la extensión ya no está */
    }
  });

  // ───────── Empezar a grabar ─────────
  async function start() {
    if (isRecording() || !meetingUrl) return false;
    phase = "recording";
    startedAt = Date.now();
    endedAt = null;
    syncBadge();
    pushLive();
    await sleep(500); // por si se activa justo al entrar a la llamada
    dbg("grabación iniciada: activando subtítulos…");
    const activos = await enableCaptions();
    dbg(`subtítulos ${activos ? "activos" : "NO se pudieron activar"}`);
    if (!activos) {
      warning = "No se pudieron activar los subtítulos de Meet: actívalos a mano con el botón «Subtítulos» (CC) de la barra de abajo.";
    }
    const { hideMeetCaptions } = await store(["hideMeetCaptions"]);
    window.ProShopCaptions.setHidden(hideMeetCaptions !== false); // por defecto la franja de Meet se esconde: se ven en el panel
    for (const ms of [1500, 5000]) setTimeout(() => !dead && dbg("pantalla de Meet: " + window.ProShopCaptions.describe()), ms);
    for (const ms of [6000, 20000]) setTimeout(() => !dead && dbg("hueco bajo el escenario: " + window.ProShopCaptions.hueco()), ms);
    syncMic(true);
    timer = setInterval(() => {
      if (dead) return;
      if (!alive()) return shutdown();
      void tick();
    }, POLL_MS);
    intervals.push(timer);
    pushLive();
    return true;
  }

  // ───────── Mensajes del panel ─────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (dead) return false;
    switch (message?.type) {
      case "GET_STATUS":
        sendResponse({ onMeeting: Boolean(meetingUrl), recording: isRecording(), lines: finalizedLines.length });
        return false;
      case "START_RECORDING": {
        if (!meetingUrl) {
          sendResponse({ ok: false, error: "Esta pestaña no es una reunión de Meet." });
          return false;
        }
        if (isRecording()) {
          sendResponse({ ok: true, already: true });
          return false;
        }
        if (phase === "stopped") resetSession(); // otra grabación en la misma reunión: empieza de cero
        lockedOrgId = message.organizationId || null;
        lockedTitle = message.title || null;
        recordingId = message.recordingId || crypto.randomUUID();
        void start().then((ok) => sendResponse({ ok }));
        return true; // respuesta async
      }
      case "PAUSE_RECORDING":
      case "RESUME_RECORDING":
        paused = message.type === "PAUSE_RECORDING";
        if (paused && pending) {
          recordIfNew(pending.name, pending.text); // lo dicho hasta ahora se conserva
          pending = null;
        }
        syncBadge();
        pushLive();
        sendResponse({ ok: true });
        return false;
      case "STOP_AND_SEND":
        void stopAndSend("detenido a mano").then(() => sendResponse({ ok: true }));
        return true; // respuesta async
      case "SET_HIDE_CAPTIONS":
        window.ProShopCaptions.setHidden(Boolean(message.hidden));
        pushLive();
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  });
})();
