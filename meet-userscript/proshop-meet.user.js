// ==UserScript==
// @name         ProShop CRM — Subtítulos de Meet
// @namespace    https://chats.proshop.lat
// @version      1.4.1
// @description  Lee los subtítulos de Google Meet y los manda al CRM, o avisa al asistente para que entre solo. Se conecta con tu sesión del CRM (sin pegar tokens). Graba también el audio (voces de la reunión + tu micrófono, solo cuando no estás silenciado) y el CRM lo transcribe con Whisper.
// @match        https://meet.google.com/*
// @match        https://chats.proshop.lat/dashboard/extension-authorize*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      chats.proshop.lat
// @run-at       document-idle
// ==/UserScript==

// Equivale a la extensión de Chrome (meet-captions-extension/) pero como userscript de Tampermonkey.
// Todo el DOM se arma con createElement/textContent -- nunca innerHTML: Meet exige Trusted Types y bloquearía
// cualquier asignación de texto a innerHTML.
(function () {
  "use strict";

  const CRM_BASE = "https://chats.proshop.lat";
  const AUTHORIZE_URL = `${CRM_BASE}/dashboard/extension-authorize`;
  const API = { me: "/api/extension/me", transcript: "/api/extension/transcript", join: "/api/extension/join-bot", audio: "/api/extension/audio", classify: "/api/extension/meetings/classify", search: "/api/extension/opportunities/search" };

  const getToken = () => GM_getValue("token", "") || "";
  const getName = () => GM_getValue("userName", "") || "";
  // Organización elegida en el panel (se recuerda). Sin elegir (cuenta de una sola organización) es null y el servidor usa la
  // organización donde la reunión ya está agendada, o la activa del CRM.
  const getOrgId = () => GM_getValue("orgId", "") || null;
  const withOrg = (orgId) => (orgId ? { organizationId: orgId } : {});
  // Nombre de la reunión (opcional): lo escrito se recuerda por reunión; vacío = el CRM usa su nombre automático.
  const titleKey = () => `titleDraft:${session ? session.code : ""}`;
  const getTitle = () => (GM_getValue(titleKey(), "") || "").replace(/\s+/g, " ").trim() || null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── Estilos y constructor de elementos (sin innerHTML)
  function el(tag, css, text, attrs) {
    const node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text != null) node.textContent = text;
    if (attrs) for (const k of Object.keys(attrs)) node.setAttribute(k, attrs[k]);
    return node;
  }
  const FONT = "font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;";
  const BTN = (bg) => `width:100%;padding:9px;border:0;border-radius:8px;background:${bg};color:#fff;font:inherit;font-weight:500;cursor:pointer;`;
  const INPUT = "width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #e9edef;border-radius:6px;font:inherit;margin-bottom:6px;";

  // ── Llamadas al CRM: GM_xmlhttpRequest no pasa por CORS
  function request(method, path, body, cb) {
    GM_xmlhttpRequest({
      method,
      url: CRM_BASE + path,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      data: body ? JSON.stringify(body) : undefined,
      timeout: 25000,
      onload: (r) => cb && cb(r.status, r.responseText),
      onerror: () => cb && cb(0, ""),
      ontimeout: () => cb && cb(0, ""),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1) En la página del CRM: guardar el token (equivale a authorize-bridge.js)
  // ═══════════════════════════════════════════════════════════════════════
  if (location.hostname === "chats.proshop.lat") {
    (async () => {
      for (let i = 0; i < 40; i++) {
        const node = document.getElementById("mext-token-bridge");
        if (node && node.dataset.token) {
          // El nombre primero: el panel de Meet se actualiza al cambiar el token y ya debe encontrar el nombre.
          GM_setValue("userName", node.dataset.name || "");
          GM_setValue("token", node.dataset.token);
          const banner = el(
            "div",
            `position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:999999;background:#059669;color:#fff;padding:10px 16px;border-radius:8px;${FONT}`,
            "ProShop CRM: userscript de Meet conectado. Ya puedes volver a la reunión.",
          );
          document.body.appendChild(banner);
          return;
        }
        await sleep(500);
      }
    })();
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2) En Meet
  // ═══════════════════════════════════════════════════════════════════════
  // Meet usa /abc-defg-hij y también /meet/abc-defg-hij.
  const MEETING_CODE_RE = /^\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/i;
  const POLL_MS = 2000;
  const END_CHECK_TICKS = 10;
  const currentCode = () => {
    const m = MEETING_CODE_RE.exec(location.pathname);
    return m ? m[1].toLowerCase() : null;
  };

  // Estado de la reunión actual (Meet es una SPA: se pasa de una a otra sin recargar la página).
  let session = null;
  let launcherEl = null;
  let badgeEl = null;
  let panelEl = null;
  let classifyEl = null;
  let panelRefresh = null;

  function newSession(code) {
    return {
      code,
      meetingUrl: `https://meet.google.com/${code}`,
      started: false,
      stopped: false, // se detuvo a mano con «Detener y enviar»
      orgId: null, // se fija al tocar «Grabar»: lo que se grabó acá sigue yendo a esa organización
      title: null, // nombre de la reunión, fijado al tocar «Grabar»
      sent: false,
      ticks: 0,
      endSignals: 0,
      maxParticipants: 0,
      timer: null,
      finalizedKeys: new Set(),
      lines: [],
      pending: null,
    };
  }

  function recordIfNew(name, text) {
    const key = `${name}:${text}`;
    if (text && !session.finalizedKeys.has(key)) {
      session.finalizedKeys.add(key);
      session.lines.push(name ? `${name}: ${text}` : text);
      updateBadge();
    }
  }
  function currentTranscript() {
    const lines = [...session.lines];
    if (session.pending && session.pending.text) lines.push(`${session.pending.name}: ${session.pending.text}`);
    return lines.join("\n");
  }

  // ── Badge: confirma que está leyendo subtítulos
  function ensureBadge() {
    if (badgeEl && badgeEl.isConnected) return badgeEl;
    badgeEl = el(
      "div",
      `position:fixed;bottom:16px;left:16px;z-index:999999;background:#111827;color:#fff;${FONT}padding:8px 12px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;gap:6px;pointer-events:none;`,
    );
    badgeEl.appendChild(el("span", "width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0;"));
    badgeEl.appendChild(el("span", "", "ProShop CRM — subtítulos: 0 líneas", { id: "ps-label" }));
    document.body.appendChild(badgeEl);
    return badgeEl;
  }
  function updateBadge() {
    if (!session) return;
    const label = ensureBadge().querySelector("#ps-label");
    if (label) label.textContent = `ProShop CRM — subtítulos: ${session.lines.length} líneas${audio ? ` · audio activo (${audio.uploaded} partes enviadas)` : ""}`;
  }


  // ── Audio: voces de la reunión (pestaña compartida) + tu micrófono, mezclados y grabados en partes de 10 min.
  // Cada parte es un archivo completo que se sube apenas termina (así no se pierde todo si se cierra la pestaña) y el CRM
  // la transcribe con Whisper. El micrófono propio solo suena mientras NO estás silenciado en Meet.
  const AUDIO_SEGMENT_MS = 10 * 60 * 1000;
  const AUDIO_BITRATE = 24000; // voz: una hora pesa ~11 MB
  let audio = null;

  function isMicMuted() {
    const node = document.querySelector('[data-is-muted][aria-label*="micrófono" i], [data-is-muted][aria-label*="microphone" i]');
    if (node) return node.getAttribute("data-is-muted") === "true";
    const fallback = findButtonByName(/micrófono|microphone/i);
    if (!fallback) return false;
    return /activar|turn on/i.test((fallback.getAttribute("aria-label") || "").trim());
  }

  function uploadAudioPart(a, blob, part, attempt) {
    const retry = () => attempt < 3 && setTimeout(() => uploadAudioPart(a, blob, part, attempt + 1), 5000 * (attempt + 1));
    GM_xmlhttpRequest({
      method: "POST",
      url: CRM_BASE + API.audio,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        "Content-Type": "audio/webm",
        "X-Meeting-Url": a.meetingUrl,
        "X-Audio-Part": String(part),
        ...(a.orgId ? { "X-Organization-Id": a.orgId } : {}),
        ...(a.title ? { "X-Meeting-Title": encodeURIComponent(a.title) } : {}),
      },
      data: blob,
      timeout: 180000,
      onload: (r) => {
        console.log(`[ProShop] Audio parte ${part} enviada:`, r.status);
        if (r.status >= 500) retry();
        else if (r.status === 401) GM_deleteValue("token");
        else if (r.status >= 200 && r.status < 300) {
          a.uploaded += 1;
          updateBadge();
        }
      },
      onerror: retry,
      ontimeout: retry,
    });
  }

  function startSegment(a) {
    const chunks = [];
    const recorder = new MediaRecorder(a.dest.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: AUDIO_BITRATE });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      clearTimeout(a.segTimer);
      const blob = new Blob(chunks, { type: "audio/webm" });
      if (blob.size > 2000) {
        a.part += 1;
        uploadAudioPart(a, blob, a.part, 0);
      }
      if (a.active) startSegment(a);
      else releaseAudio(a);
    };
    recorder.start(1000);
    a.recorder = recorder;
    a.segTimer = setTimeout(() => recorder.state !== "inactive" && recorder.stop(), AUDIO_SEGMENT_MS);
  }

  function releaseAudio(a) {
    clearInterval(a.muteTimer);
    for (const stream of [a.tabStream, a.micStream]) if (stream) stream.getTracks().forEach((t) => t.stop());
    if (a.ctx && a.ctx.state !== "closed") a.ctx.close();
  }

  // Termina la grabación: la última parte se sube igual. Seguro de llamar varias veces.
  function stopAudio() {
    if (!audio) return;
    const a = audio;
    audio = null;
    a.active = false;
    if (a.recorder && a.recorder.state !== "inactive") a.recorder.stop();
    else releaseAudio(a);
    updateBadge();
  }

  // Devuelve un mensaje para el panel. Debe llamarse directo desde el clic (Chrome exige un gesto para compartir pestaña).
  async function startAudio() {
    if (!session || audio) return "";
    if (!getToken()) return "Sin conexión con el CRM: no se grabó el audio.";
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, preferCurrentTab: true, selfBrowserSurface: "include", systemAudio: "include" });
    } catch (e) {
      return "No se pudo grabar el audio: hay que permitir compartir esta pestaña (con audio).";
    }
    display.getVideoTracks().forEach((t) => t.stop());
    if (display.getAudioTracks().length === 0) {
      display.getTracks().forEach((t) => t.stop());
      return "No se pudo grabar el audio: marca «Compartir audio de la pestaña» y vuelve a intentar.";
    }

    const a = { active: true, part: 0, uploaded: 0, meetingUrl: session.meetingUrl, orgId: session.orgId || getOrgId(), title: session.title || getTitle(), tabStream: new MediaStream(display.getAudioTracks()), micStream: null, recorder: null };
    a.ctx = new AudioContext();
    a.dest = a.ctx.createMediaStreamDestination();
    a.ctx.createMediaStreamSource(a.tabStream).connect(a.dest); // sin conectar a los parlantes: la pestaña sigue sonando normal
    let micNote = "";
    try {
      a.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      a.ctx.createMediaStreamSource(a.micStream).connect(a.dest);
      const track = a.micStream.getAudioTracks()[0];
      track.enabled = !isMicMuted();
      a.muteTimer = setInterval(() => {
        track.enabled = !isMicMuted();
      }, 300);
    } catch (e) {
      micNote = " (sin tu micrófono: permite el acceso para grabar tu voz)";
    }
    a.tabStream.getAudioTracks()[0].addEventListener("ended", () => audio === a && stopAudio());
    audio = a;
    startSegment(a);
    updateBadge();
    return `Audio activado${micNote}.`;
  }

  // ── Lectura de subtítulos (mismos selectores que la extensión de Chrome)
  function findButtonByName(regex) {
    for (const node of document.querySelectorAll('[role="button"], button')) {
      const name = (node.getAttribute("aria-label") || node.textContent || "").trim();
      if (regex.test(name)) return node;
    }
    return null;
  }

  async function enableCaptions() {
    const button = findButtonByName(/subt[ií]tulos|captions/i);
    if (!button) return false;
    button.click();
    await sleep(800);
    try {
      const combo = document.querySelector('[role="combobox"][aria-label*="idioma de la reunión" i], [role="combobox"][aria-label*="meeting language" i]');
      if (combo) {
        combo.focus();
        combo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await sleep(500);
        const spanish = [...document.querySelectorAll('[role="option"]')].find((o) => /español/i.test(o.textContent || ""));
        if (spanish) {
          spanish.scrollIntoView({ block: "center" });
          spanish.click();
        }
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }
    } catch (e) {
      /* el idioma es opcional */
    }
    return true;
  }

  function readCaptionsPanel() {
    const region = document.querySelector('[role="region"][aria-label="Subtítulos"], [role="region"][aria-label="Captions"]');
    if (!region) return { blocks: [], fallback: "" };
    const blockEls = Array.from(region.querySelectorAll(".nMcdL"));
    if (blockEls.length > 0) {
      return {
        blocks: blockEls.map((node) => ({
          name: (node.querySelector(".NWpY1d") && node.querySelector(".NWpY1d").textContent.trim()) || "Alguien",
          text: (node.querySelector(".ygicle") && node.querySelector(".ygicle").textContent.trim()) || "",
        })),
        fallback: "",
      };
    }
    return { blocks: [], fallback: (region.innerText || "").trim() };
  }

  // La reunión "terminó" cuando ya no hay botón de personas, o quedó una sola después de haber habido más.
  function meetingLooksOver() {
    const node = findButtonByName(/personas|people/i);
    if (!node) return true;
    const match = (node.textContent || "").match(/\d+/);
    const count = match ? Number(match[0]) : null;
    if (count === null) return false;
    if (count > session.maxParticipants) session.maxParticipants = count;
    if (session.maxParticipants <= 1) return false;
    return count <= 1;
  }

  function sendTranscript(reason) {
    if (!session || session.sent) return;
    const transcript = currentTranscript().trim();
    if (transcript.length < 40) {
      console.log(`[ProShop] No se manda (${reason}): transcripción muy corta (${transcript.length}).`);
      return;
    }
    if (!getToken()) {
      console.warn("[ProShop] Sin sesión del CRM: abre el panel y pulsa «Conectar con el CRM».");
      return;
    }
    session.sent = true;
    const s = session;
    request("POST", API.transcript, { meetingUrl: s.meetingUrl, transcript, ...withOrg(s.orgId), ...(s.title ? { title: s.title } : {}) }, (status) => {
      console.log(`[ProShop] Transcripción enviada (${reason}):`, status);
      if (status === 0 || status >= 500) s.sent = false; // se reintenta en el próximo aviso de fin
      if (status === 401) GM_deleteValue("token");
      if (panelRefresh) panelRefresh(status >= 200 && status < 300 ? "Transcripción enviada al CRM." : "No se pudo enviar la transcripción.");
    });
  }

  function tick() {
    if (!session || !session.started) return;
    session.ticks += 1;
    const { blocks, fallback } = readCaptionsPanel();
    if (blocks.length > 0) {
      for (let i = 0; i < blocks.length - 1; i++) recordIfNew(blocks[i].name, blocks[i].text);
      session.pending = blocks[blocks.length - 1] || null;
    } else if (fallback && fallback.length >= 25) {
      recordIfNew("", fallback);
    }
    if (session.ticks % END_CHECK_TICKS === 0) {
      if (meetingLooksOver()) {
        session.endSignals += 1;
        if (session.endSignals >= 2 && !session.sent) {
          if (session.pending) recordIfNew(session.pending.name, session.pending.text);
          sendTranscript("fin de reunión detectado");
          stopAudio();
          showClassifyPanel();
        }
      } else {
        session.endSignals = 0;
      }
    }
  }

  async function startRecording() {
    if (!session || session.started) return;
    session.started = true;
    session.orgId = getOrgId();
    session.title = getTitle();
    ensureBadge();
    await sleep(500);
    await enableCaptions();
    session.timer = setInterval(tick, POLL_MS);
  }

  // Al salir de la reunión (o pasar a otra): se manda lo que haya y se limpia todo.
  function endSession(reason) {
    if (!session) return;
    stopAudio();
    if (session.started) {
      if (session.pending) recordIfNew(session.pending.name, session.pending.text);
      sendTranscript(reason);
    }
    if (session.timer) clearInterval(session.timer);
    session = null;
    for (const node of [badgeEl, panelEl, classifyEl, launcherEl]) if (node) node.remove();
    badgeEl = panelEl = classifyEl = launcherEl = null;
    panelRefresh = null;
  }

  // ── Panel principal
  function showPanel() {
    if (panelEl && panelEl.isConnected) return;
    panelEl = el("div", `position:fixed;top:64px;right:16px;z-index:999999;width:290px;background:#fff;color:#111b21;${FONT}border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);padding:14px;`);

    const head = el("div", "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;");
    head.appendChild(el("strong", "font-size:13px;", "ProShop CRM"));
    const close = el("span", "cursor:pointer;color:#667781;font-size:18px;line-height:1;", "×");
    close.addEventListener("click", () => {
      panelEl.remove();
      panelEl = null;
      panelRefresh = null;
    });
    head.appendChild(close);
    panelEl.appendChild(head);

    const account = el("div", "margin-bottom:10px;");
    const accountText = el("div", "font-size:12px;margin-bottom:6px;");
    const connectBtn = el("button", BTN("#2563eb"), "Conectar con el CRM");
    connectBtn.addEventListener("click", () => window.open(AUTHORIZE_URL, "_blank"));
    const logoutBtn = el("button", "border:0;background:none;color:#667781;font:inherit;font-size:11px;cursor:pointer;padding:0;text-decoration:underline;", "Cerrar sesión");
    logoutBtn.addEventListener("click", () => {
      GM_deleteValue("token");
      GM_deleteValue("userName");
      refresh();
    });
    account.append(accountText, connectBtn, logoutBtn);
    panelEl.appendChild(account);

    const titleBox = el("div", "margin-bottom:10px;");
    titleBox.appendChild(el("label", "display:block;font-size:11px;color:#667781;margin-bottom:4px;", "Nombre de la reunión (opcional)"));
    const titleInput = el("input", "width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #e9edef;border-radius:6px;font:inherit;", null, { type: "text", maxlength: "160", placeholder: "Ej.: Demo con Ana - Financiera" });
    titleInput.value = GM_getValue(titleKey(), "") || "";
    titleInput.addEventListener("input", () => GM_setValue(titleKey(), titleInput.value));
    titleBox.appendChild(titleInput);
    panelEl.appendChild(titleBox);

    const orgBox = el("div", "margin-bottom:10px;display:none;");
    orgBox.appendChild(el("label", "display:block;font-size:11px;color:#667781;margin-bottom:4px;", "Organización de esta reunión"));
    const orgSelect = el("select", "width:100%;padding:7px 8px;border:1px solid #e9edef;border-radius:6px;font:inherit;");
    const orgOnly = el("div", "font-size:12px;display:none;");
    orgBox.append(orgSelect, orgOnly);
    panelEl.appendChild(orgBox);
    orgSelect.addEventListener("change", () => GM_setValue("orgId", orgSelect.value));

    function loadOrganizations() {
      orgBox.style.display = "none";
      if (!getToken()) return;
      request("GET", API.me, null, (statusCode, text) => {
        let data = null;
        try { data = JSON.parse(text); } catch (e) { /* sin datos */ }
        if (!data || !data.organizations || data.organizations.length === 0) return;
        const saved = getOrgId();
        const selected = data.organizations.some((o) => o.id === saved) ? saved : data.activeOrganizationId;
        orgSelect.replaceChildren();
        for (const o of data.organizations) {
          const option = el("option", "", o.name);
          option.value = o.id;
          orgSelect.appendChild(option);
        }
        orgSelect.value = selected;
        GM_setValue("orgId", selected);
        const several = data.organizations.length > 1;
        orgSelect.style.display = several ? "block" : "none";
        orgOnly.style.display = several ? "none" : "block";
        if (!several) orgOnly.textContent = `Organización: ${data.organizations[0].name}`;
        orgBox.style.display = "block";
        refresh();
      });
    }

    const recordBtn = el("button", BTN("#c62828") + "margin-bottom:6px;", "Grabar esta reunión");
    const audioBtn = el("button", BTN("#455a64") + "margin-bottom:6px;display:none;", "Activar audio (voces + micrófono)");
    const stopBtn = el("button", BTN("#b71c1c") + "margin-bottom:6px;display:none;", "Detener y enviar");
    const joinBtn = el("button", BTN("#00a884"), "Unir al asistente");
    const status = el("div", "font-size:11px;color:#059669;margin-top:8px;min-height:14px;");
    panelEl.append(recordBtn, audioBtn, stopBtn, joinBtn, status);

    const setStatus = (text, bad) => {
      status.textContent = text || "";
      status.style.color = bad ? "#dc2626" : "#059669";
    };

    function refresh(message) {
      const logged = Boolean(getToken());
      accountText.textContent = logged ? `Conectado${getName() ? " como " + getName() : ""}.` : "Sin conectar: abre tu sesión del CRM para que se identifique.";
      accountText.style.color = logged ? "#059669" : "#b45309";
      connectBtn.style.display = logged ? "none" : "block";
      logoutBtn.style.display = logged ? "inline" : "none";
      recordBtn.disabled = !session || session.started;
      recordBtn.style.opacity = recordBtn.disabled ? "0.5" : "1";
      if (session && session.started) recordBtn.textContent = session.stopped ? "Grabación enviada" : audio ? "Grabando subtítulos y audio…" : "Grabando subtítulos…";
      audioBtn.style.display = session && session.started && !session.stopped && !audio ? "block" : "none";
      stopBtn.style.display = session && session.started && !session.stopped ? "block" : "none";
      if (message) setStatus(message, /no se pudo|falta|sin /i.test(message));
    }
    document.body.appendChild(panelEl);
    panelRefresh = refresh;
    refresh();
    loadOrganizations();

    recordBtn.addEventListener("click", () => {
      // El audio va primero y sin await antes: Chrome solo deja compartir la pestaña si viene directo del clic.
      const audioResult = startAudio();
      void startRecording();
      refresh("Subtítulos activados.");
      audioResult.then((message) => message && refresh(message));
    });
    stopBtn.addEventListener("click", () => {
      if (!session || !session.started || session.stopped) return;
      if (session.pending) recordIfNew(session.pending.name, session.pending.text);
      clearInterval(session.timer);
      session.timer = null;
      session.stopped = true;
      stopAudio(); // sube la última parte del audio
      sendTranscript("detenido a mano");
      showClassifyPanel();
      refresh("Grabación detenida y enviada. El audio termina de subirse en unos segundos: no cierres la pestaña todavía.");
    });
    audioBtn.addEventListener("click", () => {
      startAudio().then((message) => refresh(message || undefined));
    });

    joinBtn.addEventListener("click", () => {
      if (!getToken()) {
        setStatus("Primero conecta con el CRM.", true);
        return;
      }
      joinBtn.disabled = true;
      request("POST", API.join, { meetingUrl: session.meetingUrl, ...withOrg(getOrgId()), ...(getTitle() ? { title: getTitle() } : {}) }, (statusCode) => {
        if (statusCode === 401) GM_deleteValue("token");
        if (!statusCode || statusCode >= 400) {
          joinBtn.disabled = false;
          refresh(statusCode === 401 ? "Sesión vencida: vuelve a conectar con el CRM." : "No se pudo avisar al asistente.");
          return;
        }
        joinBtn.textContent = "Asistente avisado";
        setStatus("Va a pedir unirse en un momento: admítelo desde Meet.");
      });
    });
  }

  // ── Panel al cortar: ¿a qué cliente fue esta reunión?
  function showClassifyPanel() {
    if (classifyEl && classifyEl.isConnected) return;
    const meetingUrl = session.meetingUrl;
    const orgForClassify = session.orgId || getOrgId();
    classifyEl = el("div", `position:fixed;bottom:16px;right:16px;z-index:999999;width:310px;background:#fff;color:#111b21;${FONT}border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.25);padding:14px;`);
    const panel = classifyEl;
    const close = () => {
      panel.remove();
      if (classifyEl === panel) classifyEl = null;
    };

    panel.appendChild(el("div", "font-weight:600;margin-bottom:8px;", "¿A qué cliente fue esta reunión?"));
    const search = el("input", INPUT, null, { placeholder: "Buscar cliente..." });
    const results = el("div", "max-height:140px;overflow:auto;");
    panel.append(search, results);

    const newBox = el("div", "display:none;margin-top:8px;");
    const newName = el("input", INPUT, null, { placeholder: "Nombre" });
    const newPhone = el("input", INPUT, null, { placeholder: "Teléfono" });
    const newSave = el("button", BTN("#00a884") + "padding:7px;", "Crear y vincular");
    newBox.append(newName, newPhone, newSave);
    panel.appendChild(newBox);

    const row = el("div", "display:flex;gap:6px;margin-top:8px;");
    const toggle = el("button", "flex:1;padding:6px;border:1px solid #e9edef;border-radius:6px;background:#fff;font:inherit;cursor:pointer;", "Cliente nuevo");
    const dismiss = el("button", "flex:1;padding:6px;border:1px solid #e9edef;border-radius:6px;background:#fff;font:inherit;cursor:pointer;", "Ahora no");
    row.append(toggle, dismiss);
    panel.appendChild(row);
    document.body.appendChild(panel);

    dismiss.addEventListener("click", close);
    toggle.addEventListener("click", () => {
      newBox.style.display = newBox.style.display === "none" ? "block" : "none";
    });

    const classify = (extra) => {
      if (getToken()) request("POST", API.classify, { meetingUrl, ...withOrg(orgForClassify), ...extra });
    };

    let debounce = null;
    search.addEventListener("input", () => {
      clearTimeout(debounce);
      const q = search.value.trim();
      results.replaceChildren();
      if (q.length < 2) return;
      debounce = setTimeout(() => {
        if (!getToken()) return;
        request("GET", `${API.search}?q=${encodeURIComponent(q)}${orgForClassify ? `&organizationId=${encodeURIComponent(orgForClassify)}` : ""}`, null, (statusCode, text) => {
          let data = {};
          try {
            data = JSON.parse(text);
          } catch (e) {
            /* sin resultados */
          }
          results.replaceChildren();
          for (const item of data.results || []) {
            const option = el("div", "padding:7px 8px;border-radius:6px;cursor:pointer;font-size:12.5px;", `${item.title} — ${item.contactName}`);
            option.addEventListener("mouseenter", () => (option.style.background = "#f0f2f5"));
            option.addEventListener("mouseleave", () => (option.style.background = "transparent"));
            option.addEventListener("click", () => {
              classify({ opportunityId: item.id });
              close();
            });
            results.appendChild(option);
          }
        });
      }, 300);
    });

    newSave.addEventListener("click", () => {
      const name = newName.value.trim();
      const phone = newPhone.value.trim();
      if (!phone) return;
      classify({ newContactName: name, newContactPhone: phone, newOpportunityTitle: name });
      close();
    });

    setTimeout(close, 45000);
  }

  // ── Botón flotante para abrir el panel (solo mientras haya una reunión)
  function ensureLauncher() {
    if (launcherEl && launcherEl.isConnected) return;
    launcherEl = el(
      "div",
      "position:fixed;top:72px;right:16px;z-index:999998;width:40px;height:40px;border-radius:50%;background:#00a884;color:#fff;font:600 13px/40px system-ui,sans-serif;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);user-select:none;",
      "PS",
      { title: "ProShop CRM" },
    );
    launcherEl.addEventListener("click", showPanel);
    document.body.appendChild(launcherEl);
  }

  // Red de seguridad al cerrar la pestaña sin que se haya detectado el fin.
  window.addEventListener("pagehide", () => {
    stopAudio();
    if (!session || !session.started || session.sent) return;
    const transcript = currentTranscript().trim();
    if (transcript.length < 40 || !getToken()) return;
    navigator.sendBeacon(CRM_BASE + API.transcript, new Blob([JSON.stringify({ meetingUrl: session.meetingUrl, transcript, token: getToken(), ...withOrg(session.orgId), ...(session.title ? { title: session.title } : {}) })], { type: "application/json" }));
  });

  // Si el token cambia (se conectó desde la otra pestaña), el panel abierto se actualiza solo.
  if (typeof GM_addValueChangeListener === "function") {
    GM_addValueChangeListener("token", () => {
      if (panelRefresh) panelRefresh();
    });
  }

  // Vigila la URL: Meet cambia de pantalla (inicio → reunión → fin) sin recargar la página.
  setInterval(() => {
    const code = currentCode();
    if (session && session.code !== code) endSession("salió de la reunión");
    if (code && !session) session = newSession(code);
    if (session) ensureLauncher();
  }, 1000);
})();
