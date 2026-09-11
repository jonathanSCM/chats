// Extensión de subtítulos de Meet — ProShop CRM.
//
// Corre dentro del navegador de quien esté en la reunión, como un
// participante más (no un bot aparte). Lee el panel de subtítulos en vivo
// de Meet exactamente igual que meeting-bot/src/captions.ts (mismos
// selectores, confirmados contra el HTML real de Meet), arma líneas
// "Nombre: lo que dijo", y al detectar que la reunión terminó las manda al
// CRM. Es una función aparte del bot grabador (meeting-bot/) -- ese sigue
// existiendo para cuando sí hace falta audio real.
(function () {
  "use strict";

  const MEETING_CODE_RE = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;
  const POLL_MS = 2000;
  const END_CHECK_TICKS = 10; // cada 10 polls (~20s) se fija si la reunión terminó
  const API_PATH = "/api/extension/transcript";

  if (!MEETING_CODE_RE.test(window.location.pathname)) return;

  const meetingUrl = `https://meet.google.com${window.location.pathname}`;

  let started = false;
  let ticks = 0;
  let consecutiveEndSignals = 0;
  let sent = false;
  const finalizedKeys = new Set();
  const finalizedLines = [];
  let pending = null;

  function recordIfNew(name, text) {
    const key = `${name}:${text}`;
    if (text && !finalizedKeys.has(key)) {
      finalizedKeys.add(key);
      finalizedLines.push(`${name}: ${text}`);
      updateBadge();
    }
  }

  function currentTranscript() {
    const lines = [...finalizedLines];
    if (pending && pending.text) lines.push(`${pending.name}: ${pending.text}`);
    return lines.join("\n");
  }

  // ── Badge flotante: confirmación visual de que está grabando subtítulos,
  // igual que cualquier notetaker comercial muestra un indicador en pantalla.
  let badgeEl = null;
  function ensureBadge() {
    if (badgeEl) return badgeEl;
    badgeEl = document.createElement("div");
    badgeEl.style.cssText =
      "position:fixed;bottom:16px;left:16px;z-index:999999;background:#111827;color:#fff;" +
      "font:12px/1.4 system-ui,sans-serif;padding:8px 12px;border-radius:8px;" +
      "box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;gap:6px;pointer-events:none;";
    const dot = document.createElement("span");
    dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0;";
    badgeEl.appendChild(dot);
    const label = document.createElement("span");
    label.id = "proshop-captions-label";
    label.textContent = "ProShop CRM — subtítulos: 0 líneas";
    badgeEl.appendChild(label);
    document.body.appendChild(badgeEl);
    return badgeEl;
  }
  function updateBadge() {
    const el = ensureBadge().querySelector("#proshop-captions-label");
    if (el) el.textContent = `ProShop CRM — subtítulos: ${finalizedLines.length} líneas`;
  }

  // ── Encontrar botones por su nombre accesible (aria-label o texto), sin
  // depender de las clases internas de Meet (que cambian con rediseños).
  function findButtonByName(regex) {
    const candidates = document.querySelectorAll('[role="button"], button');
    for (const el of candidates) {
      const name = (el.getAttribute("aria-label") || el.textContent || "").trim();
      if (regex.test(name)) return el;
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Activa subtítulos y los pone en español, igual que hace el bot
  // (services captions.ts) pero con DOM plano en vez de Playwright.
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
        const options = document.querySelectorAll('[role="option"]');
        const spanish = [...options].find((o) => /español/i.test(o.textContent || ""));
        if (spanish) {
          spanish.scrollIntoView({ block: "center" });
          spanish.click();
        }
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }
    } catch {
      // Sin idioma en español, Meet igual sigue transcribiendo (puede que en
      // inglés) — mejor eso que no tener nada.
    }
    return true;
  }

  // ── Mismo selector que meeting-bot/src/captions.ts, confirmado contra el
  // HTML real de una reunión con subtítulos andando.
  function readCaptionsPanel() {
    const region = document.querySelector('[role="region"][aria-label="Subtítulos"]');
    if (!region) return { blocks: [], fallback: "" };

    const blockEls = Array.from(region.querySelectorAll(".nMcdL"));
    if (blockEls.length > 0) {
      const blocks = blockEls.map((el) => ({
        name: el.querySelector(".NWpY1d")?.textContent?.trim() || "Alguien",
        text: el.querySelector(".ygicle")?.textContent?.trim() || "",
      }));
      return { blocks, fallback: "" };
    }
    return { blocks: [], fallback: (region.innerText || "").trim() };
  }

  function meetingLooksOver() {
    const el = findButtonByName(/personas|people/i);
    if (!el) return true;
    const match = (el.textContent || "").match(/\d+/);
    return match ? Number(match[0]) <= 1 : false;
  }

  async function sendTranscript(reason) {
    if (sent) return;
    const transcript = currentTranscript().trim();
    if (transcript.length < 40) {
      // Antes esto cortaba en silencio -- en una prueba corta (dos líneas
      // de "hola, probando") parecía que la extensión no había hecho nada,
      // cuando en realidad decidió a propósito no mandar algo tan corto.
      console.log(
        `[proshop-captions] No se manda (${reason}): transcripción muy corta (${transcript.length} caracteres, mínimo 40). Texto: "${transcript}"`,
      );
      return;
    }
    sent = true;

    chrome.storage.local.get(["apiBase", "token"], async ({ apiBase, token }) => {
      if (!token) {
        console.warn("[proshop-captions] Sin token configurado — abrí el ícono de la extensión y pegalo.");
        return;
      }
      const base = (apiBase || "https://chats.proshop.lat").replace(/\/$/, "");
      try {
        const res = await fetch(base + API_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ meetingUrl, transcript }),
        });
        console.log(`[proshop-captions] Transcripción enviada (${reason}):`, res.status);
      } catch (error) {
        console.error("[proshop-captions] No se pudo enviar la transcripción:", error);
        sent = false; // permite reintentar en el próximo intento de cierre
      }
    });
  }

  async function tick() {
    ticks += 1;
    const { blocks, fallback } = readCaptionsPanel();

    if (blocks.length > 0) {
      for (let i = 0; i < blocks.length - 1; i++) recordIfNew(blocks[i].name, blocks[i].text);
      pending = blocks[blocks.length - 1] || null;
    } else if (fallback && fallback.length >= 25) {
      recordIfNew("", fallback);
    }

    if (ticks % END_CHECK_TICKS === 0) {
      if (meetingLooksOver()) {
        consecutiveEndSignals += 1;
        if (consecutiveEndSignals >= 2) {
          if (pending) recordIfNew(pending.name, pending.text);
          void sendTranscript("fin de reunión detectado");
        }
      } else {
        consecutiveEndSignals = 0;
      }
    }
  }

  // Red de seguridad: si se cierra la pestaña sin que se detecte el fin de
  // la reunión (el chequeo de arriba corre cada ~20s), sendBeacon manda lo
  // acumulado hasta ese momento -- sendBeacon no permite headers custom, así
  // que acá el token viaja en el body en vez de en Authorization (el
  // endpoint acepta las dos formas).
  window.addEventListener("pagehide", () => {
    if (!started || sent) return;
    const transcript = currentTranscript().trim();
    if (transcript.length < 40) return;
    chrome.storage.local.get(["apiBase", "token"], ({ apiBase, token }) => {
      if (!token) return;
      const base = (apiBase || "https://chats.proshop.lat").replace(/\/$/, "");
      const blob = new Blob([JSON.stringify({ meetingUrl, transcript, token })], {
        type: "application/json",
      });
      navigator.sendBeacon(base + API_PATH, blob);
    });
  });

  async function start() {
    if (started) return;
    started = true;
    ensureBadge();
    await sleep(500); // ya está en la llamada hace rato para cuando se activa a mano
    await enableCaptions();
    setInterval(() => void tick(), POLL_MS);
  }

  // No arranca solo: hay que abrir el ícono de la extensión y tocar "Grabar
  // esta reunión" para cada reunión en la que se quiera usar. Sin eso, esta
  // pestaña de Meet no manda absolutamente nada -- ni siquiera empieza a
  // leer subtítulos ni activa el badge.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_STATUS") {
      sendResponse({ onMeeting: true, recording: started, lines: finalizedLines.length });
      return false;
    }
    if (message?.type === "START_RECORDING") {
      void start().then(() => sendResponse({ ok: true }));
      return true; // respuesta async
    }
    return false;
  });
})();
