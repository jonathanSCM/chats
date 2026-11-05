#!/usr/bin/env node
// Parche de ProShop CRM sobre el bot de Vexa (dist/capture-bridge.js), para
// que además de grabar/transcribir con Whisper (lo que Vexa ya hace),
// también active y capture los subtítulos en vivo de Google Meet como
// fuente de transcripción independiente -- Vexa no lo hace para Meet
// (solo para Teams, y ahí únicamente para atribuir nombres, nunca como
// texto de transcripción real).
//
// Se aplica en caliente en cada arranque del contenedor (ver
// patch-and-start.sh) porque no vamos a mantenernos al día con las
// actualizaciones de Vexa -- parchear la imagen misma se perdería en cada
// pull. Idempotente: si ya encuentra el marcador, no hace nada.

const fs = require("fs");

const TARGET = process.argv[2] || "/app/core/meetings/services/bot/dist/capture-bridge.js";
const MARKER = "__PROSHOP_MEET_CAPTIONS_PATCH__";
const ANCHOR = "window.__vexa_voice_agent_enabled";

const appUrl = process.env.PROSHOP_APP_URL || "";
const token = process.env.PROSHOP_MEET_CAPTIONS_TOKEN || "";

if (!appUrl || !token) {
  console.warn("[proshop-patch] PROSHOP_APP_URL/PROSHOP_MEET_CAPTIONS_TOKEN no configurados -- se omite el parche.");
  process.exit(0);
}

let src;
try {
  src = fs.readFileSync(TARGET, "utf-8");
} catch (error) {
  console.error(`[proshop-patch] No se pudo leer ${TARGET}:`, error.message);
  process.exit(1);
}

const INJECTED_VERSION = "session-id-v2"; // súbelo cuando cambie lo que se inyecta: se reemplaza el bloque anterior
if (src.includes(MARKER)) {
  if (src.includes(`/* ${INJECTED_VERSION} */`)) {
    console.log("[proshop-patch] Ya estaba parchado con esta versión -- nada que hacer.");
    process.exit(0);
  }
  // Versión anterior: se saca su bloque (una sola línea larga: el script va como literal JSON) y se inyecta de nuevo.
  const OLD_BLOCK = /\n  \/\/ __PROSHOP_MEET_CAPTIONS_PATCH__\n(?:  \/\* [a-z0-9-]+ \*\/\n)?  if \(inv\.platform === 'google_meet'\) \{\n    await context\.addInitScript\(.*\)\.catch\(\(\) => \{\}\);\n  \}\n/;
  if (!OLD_BLOCK.test(src)) {
    console.error("[proshop-patch] Ya estaba parchado con una versión anterior pero no se pudo ubicar su bloque -- se deja como está.");
    process.exit(0);
  }
  src = src.replace(OLD_BLOCK, "");
  console.log("[proshop-patch] Reemplazando el parche anterior.");
}

const anchorIdx = src.indexOf(ANCHOR);
if (anchorIdx === -1) {
  console.error(`[proshop-patch] No se encontró la línea ancla ("${ANCHOR}") -- Vexa debe haber cambiado de versión. No se aplica el parche, el bot sigue andando normal (solo Whisper).`);
  process.exit(0); // no fatal -- que el contenedor arranque igual
}

// Encuentra el final de la sentencia `await context.addInitScript(...);` que
// contiene el ancla, para insertar justo después.
const stmtEnd = src.indexOf(");", anchorIdx);
if (stmtEnd === -1) {
  console.error("[proshop-patch] No se pudo ubicar el final de la sentencia ancla -- se omite el parche.");
  process.exit(0);
}
const insertAt = stmtEnd + 2;

// Código que corre DENTRO de la página del bot -- versión recortada de
// meet-captions-extension/content.js (mismos selectores de subtítulos ya
// confirmados contra el HTML real de Meet), sin badge ni chrome.* (acá no
// hay APIs de extensión, es un addInitScript crudo). Activa subtítulos
// (Vexa no lo hace para Meet) y manda lo acumulado cada 20s + en pagehide a
// la MISMA ruta que ya usa la extensión (api/extension/transcript) -- así
// no hace falta tocar nada del lado de la app. Usa newlines reales; el
// JSON.stringify de más abajo se encarga de todo el escapado sin que haya
// que contar barras invertidas a mano.
const browserCode = `(() => {
  "use strict";
  try { window.logBot && window.logBot("proshop-meet-captions: init"); } catch (e) {}
  var APP_URL = ${JSON.stringify(appUrl)};
  var TOKEN = ${JSON.stringify(token)};
  var API_PATH = "/api/extension/transcript";
  var POLL_MS = 2000;
  var finalizedKeys = new Set();
  var finalizedLines = [];
  var pending = null;

  function currentMeetingUrl() {
    return "https://meet.google.com" + window.location.pathname;
  }

  // Id de la sesión del bot en Vexa (lo pone el lado Node al inyectar el script). El CRM lo guarda en cada reunión,
  // así sabe EXACTAMENTE de qué reunión y de qué organización es lo que se manda, sin depender del link de Meet.
  function sessionId() {
    return typeof window.__PROSHOP_SESSION_ID__ === "number" ? window.__PROSHOP_SESSION_ID__ : null;
  }

  function findButtonByName(regex) {
    var candidates = document.querySelectorAll('[role="button"], button');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var name = (el.getAttribute("aria-label") || el.textContent || "").trim();
      if (regex.test(name)) return el;
    }
    return null;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function dumpButtons() {
    try {
      var els = document.querySelectorAll('[role="button"], button');
      var labels = [];
      for (var i = 0; i < els.length && labels.length < 40; i++) {
        var l = (els[i].getAttribute("aria-label") || els[i].textContent || "").trim();
        if (l) labels.push(l);
      }
      window.logBot && window.logBot("proshop-meet-captions: botones=" + JSON.stringify(labels));
    } catch (e) {}
  }

  async function enableCaptions() {
    var button = findButtonByName(/subt[ií]tulos|captions/i);
    try { window.logBot && window.logBot("proshop-meet-captions: enableCaptions button=" + (button ? "found" : "NOT FOUND")); } catch (e) {}
    if (!button) { dumpButtons(); return false; }
    button.click();
    await sleep(800);
    try {
      var combo = document.querySelector('[role="combobox"][aria-label*="idioma de la reunión" i], [role="combobox"][aria-label*="meeting language" i]');
      if (combo) {
        combo.focus();
        combo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await sleep(500);
        var options = document.querySelectorAll('[role="option"]');
        var spanish = null;
        for (var i = 0; i < options.length; i++) {
          if (/español/i.test(options[i].textContent || "")) { spanish = options[i]; break; }
        }
        if (spanish) { spanish.scrollIntoView({ block: "center" }); spanish.click(); }
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }
    } catch (e) { /* sigue igual en el idioma que haya quedado */ }
    return true;
  }

  function readCaptionsPanel() {
    // Vexa fuerza la UI de Meet en inglés (?hl=en) aunque el resto del
    // fingerprint pida es-BO -- hay que matchear los dos idiomas del
    // aria-label del panel.
    var region = document.querySelector('[role="region"][aria-label="Subtítulos"], [role="region"][aria-label="Captions"]');
    if (!region) return { blocks: [], fallback: "" };
    var blockEls = region.querySelectorAll(".nMcdL");
    if (blockEls.length > 0) {
      var blocks = [];
      for (var i = 0; i < blockEls.length; i++) {
        var nameEl = blockEls[i].querySelector(".NWpY1d");
        var textEl = blockEls[i].querySelector(".ygicle");
        blocks.push({ name: (nameEl && nameEl.textContent.trim()) || "Alguien", text: (textEl && textEl.textContent.trim()) || "" });
      }
      return { blocks: blocks, fallback: "" };
    }
    return { blocks: [], fallback: (region.innerText || "").trim() };
  }

  function recordIfNew(name, text) {
    var key = name + ":" + text;
    if (text && !finalizedKeys.has(key)) { finalizedKeys.add(key); finalizedLines.push(name + ": " + text); }
  }

  // Cuánto de finalizedLines ya se mandó -- cada tick manda solo lo NUEVO
  // desde la última vez, no todo lo acumulado de nuevo (el servidor suma
  // cada llamada a lo que ya tenía; mandar todo de nuevo cada 20s
  // duplicaría el texto en cascada).
  var lastSentIndex = 0;

  function pendingLine() {
    return pending && pending.text ? pending.name + ": " + pending.text : "";
  }

  async function sendTranscript(isFinal) {
    var newLines = finalizedLines.slice(lastSentIndex);
    var delta = newLines.join(String.fromCharCode(10));
    if (isFinal) {
      var p = pendingLine();
      if (p) delta = delta ? delta + String.fromCharCode(10) + p : p;
    }
    delta = delta.trim();
    if (delta.length < 40) {
      try { window.logBot && window.logBot("proshop-meet-captions: sendTranscript skipped, len=" + delta.length); } catch (e) {}
      return;
    }
    try {
      var res = await fetch(APP_URL.replace(/\\/$/, "") + API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
        body: JSON.stringify({ meetingUrl: currentMeetingUrl(), vexaSessionId: sessionId(), transcript: delta, final: !!isFinal }),
      });
      lastSentIndex = finalizedLines.length;
      try { window.logBot && window.logBot("proshop-meet-captions: sendTranscript status=" + res.status); } catch (e2) {}
    } catch (e) {
      try { window.logBot && window.logBot("proshop-meet-captions: fetch failed: " + (e && e.message)); } catch (e2) {}
    }
  }

  window.addEventListener("pagehide", function () {
    var newLines = finalizedLines.slice(lastSentIndex);
    var p = pendingLine();
    var delta = newLines.join(String.fromCharCode(10));
    if (p) delta = delta ? delta + String.fromCharCode(10) + p : p;
    delta = delta.trim();
    if (delta.length < 40) return;
    var blob = new Blob([JSON.stringify({ meetingUrl: currentMeetingUrl(), vexaSessionId: sessionId(), transcript: delta, token: TOKEN, final: true })], { type: "application/json" });
    navigator.sendBeacon(APP_URL.replace(/\\/$/, "") + API_PATH, blob);
  });

  // ── Comandos por el chat de la propia reunión de Meet ──────────────────
  // El vendedor escribe "/bot estado" (o resumen/detener) en el chat de
  // Meet (lo ve todo el mundo en la llamada, a propósito -- ver la
  // conversación con el usuario). Se detecta como texto nuevo en el panel
  // de chat, se manda a api/extension/meeting-command, y la respuesta se
  // escribe de vuelta ahí mismo.
  var COMMAND_PATH = "/api/extension/meeting-command";
  var seenChatLines = new Set();
  var chatWatcherStarted = false;

  // Diagnostico independiente de window.logBot -- confirmado en vivo que
  // logBot no estaba sonando para nada (ni found/not-found del boton de
  // chat) aunque los subtitulos SI funcionaban (usan otro canal, no
  // logBot). beacon() manda un aviso directo a nuestro propio servidor
  // (mismo endpoint de comandos, con el prefijo "debug:" que el servidor
  // solo loguea) para tener visibilidad real la proxima vez, sin depender
  // de si logBot esta pegado.
  function beacon(msg) {
    try {
      fetch(APP_URL.replace(/\\/$/, "") + COMMAND_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
        body: JSON.stringify({ meetingUrl: currentMeetingUrl(), vexaSessionId: sessionId(), command: "debug:" + msg }),
      }).catch(function () {});
    } catch (e) {}
  }

  function findChatPanel() {
    // Distintas versiones/idiomas de Meet nombran esto distinto -- se
    // prueban varios candidatos; si ninguno matchea, dumpRegions() deja
    // rastro de qué regiones hay de verdad para ajustar esto después.
    return document.querySelector(
      '[aria-label="Historial de chat"], [aria-label="Chat history"], ' +
        '[aria-label="Mensajes"][role="region"], [aria-label="Messages"][role="region"]',
    );
  }

  function dumpRegions() {
    try {
      var regions = document.querySelectorAll('[role="region"]');
      var labels = [];
      for (var i = 0; i < regions.length; i++) {
        var l = regions[i].getAttribute("aria-label");
        if (l) labels.push(l);
      }
      window.logBot && window.logBot("proshop-meet-chat: regiones=" + JSON.stringify(labels));
    } catch (e) {}
  }

  async function enableChat() {
    if (findChatPanel()) return true;
    var button = findButtonByName(/^chat\\b|chat con todos|chat with everyone/i);
    beacon("boton chat=" + (button ? "found" : "NOT FOUND"));
    try { window.logBot && window.logBot("proshop-meet-chat: botón chat=" + (button ? "found" : "NOT FOUND")); } catch (e) {}
    if (!button) { dumpButtons(); return false; }
    button.click();
    await sleep(800);
    var opened = Boolean(findChatPanel());
    beacon("panel tras click=" + (opened ? "abierto" : "NO abrio"));
    return opened;
  }

  function findChatInput() {
    var candidates = document.querySelectorAll(
      'textarea, [contenteditable="true"]',
    );
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var label = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").toLowerCase();
      if (label.indexOf("mensaje") !== -1 || label.indexOf("message") !== -1) return el;
    }
    return null;
  }

  async function sendChatMessage(text) {
    var opened = await enableChat();
    if (!opened) { try { window.logBot && window.logBot("proshop-meet-chat: no se pudo abrir el chat para responder"); } catch (e) {} return; }
    var input = findChatInput();
    if (!input) {
      try { window.logBot && window.logBot("proshop-meet-chat: no encontré el campo de texto del chat"); } catch (e) {}
      return;
    }
    input.focus();
    document.execCommand("insertText", false, text);
    await sleep(200);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  }

  async function handleChatCommand(rawLine) {
    // Ojo acá: este archivo (apply-patch.js) define browserCode como un
    // template literal -- una sola barra invertida sin escapar (\\s, \\/)
    // se pierde sola al evaluarlo (\\s -> s, \\/ -> /), rompiendo cualquier
    // regex con barra invertida sin que node --check lo detecte (revisa un
    // string, no el código que ese string contiene). Por eso las barras de
    // acá van DOBLES -- confirmado con un bug real: "/\\/bot\\s+(.+)/i" se
    // convertía en "//bots+(.+)/i" antes de este comentario.
    var match = rawLine.match(/\\/bot\\s+(.+)/i);
    if (!match) return;
    var command = match[1].trim();
    beacon("comando detectado -> " + command);
    try { window.logBot && window.logBot("proshop-meet-chat: comando detectado -> " + command); } catch (e) {}
    try {
      var res = await fetch(APP_URL.replace(/\\/$/, "") + COMMAND_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
        body: JSON.stringify({ meetingUrl: currentMeetingUrl(), vexaSessionId: sessionId(), command: command }),
      });
      var data = await res.json().catch(function () { return null; });
      var reply = (data && data.reply) || "Asistente: no pude procesar el comando (" + res.status + ").";
      beacon("respuesta del servidor status=" + res.status + " reply=" + reply);
      await sendChatMessage(reply);
    } catch (e) {
      beacon("fetch de comando fallo: " + (e && e.message));
      try { window.logBot && window.logBot("proshop-meet-chat: fetch de comando falló: " + (e && e.message)); } catch (e2) {}
    }
  }

  async function watchChat() {
    if (chatWatcherStarted) return;
    beacon("watchChat tick");
    // Es la propia pestaña del bot -- nadie más va a abrir el chat por él,
    // así que lo abre solo (no afecta lo que ve el vendedor ni el cliente,
    // cada quien tiene su propia UI de Meet).
    var opened = await enableChat();
    if (!opened) { beacon("watchChat: enableChat fallo"); dumpRegions(); return; }
    var panel = findChatPanel();
    if (!panel) { beacon("watchChat: no encontro el panel tras abrir"); dumpRegions(); return; }
    chatWatcherStarted = true;
    beacon("observando el panel de chat OK");
    var lastText = "";
    new MutationObserver(function () {
      var text = panel.innerText || "";
      if (text === lastText) return;
      // Solo lo que se agregó desde la última vez -- Meet nunca borra
      // mensajes viejos del historial, así que el string previo es
      // siempre un prefijo del nuevo.
      var added = text.indexOf(lastText) === 0 ? text.slice(lastText.length) : text;
      lastText = text;
      var lines = added.split(String.fromCharCode(10));
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || seenChatLines.has(line)) continue;
        seenChatLines.add(line);
        if (/\\/bot\\s+/i.test(line)) handleChatCommand(line);
      }
    }).observe(panel, { childList: true, subtree: true, characterData: true });
    try { window.logBot && window.logBot("proshop-meet-chat: observando el panel de chat"); } catch (e) {}
  }

  (async function start() {
    beacon("script arrancado, platform=google_meet");
    await sleep(3000); // le da tiempo a Vexa a terminar de unirse antes de tocar la UI
    var captionsOn = false;
    for (var attempt = 0; attempt < 8 && !captionsOn; attempt++) {
      captionsOn = await enableCaptions();
      if (!captionsOn) await sleep(4000);
    }
    setInterval(async function () {
      var r = readCaptionsPanel();
      if (r.blocks.length > 0) {
        for (var i = 0; i < r.blocks.length - 1; i++) recordIfNew(r.blocks[i].name, r.blocks[i].text);
        pending = r.blocks[r.blocks.length - 1] || null;
      } else if (r.fallback && r.fallback.length >= 25) {
        recordIfNew("", r.fallback);
      }
    }, POLL_MS);
    setInterval(sendTranscript, 20000);

    // El chat no se abre solo -- se intenta cada pocos segundos hasta que
    // el panel exista (el vendedor puede tardar en tener la UI lista, o
    // Meet puede no haber terminado de cargar los botones todavía).
    setInterval(watchChat, 5000);
  })();
})();`;

// `JSON.stringify(browserCode)` produce un literal de string ya escapado
// (comillas dobles, \\n, \\", etc.) -- se pega tal cual como argumento de
// `context.addInitScript(...)`, sin anidar template literals: cuando el bot
// vuelva a cargar este archivo, es un simple string literal más, sin
// ambigüedad de escapado.
const injected = `
  // ${MARKER}
  /* ${INJECTED_VERSION} */
  if (inv.platform === 'google_meet') {
    await context.addInitScript("window.__PROSHOP_SESSION_ID__ = " + JSON.stringify(typeof inv.meeting_id === "number" ? inv.meeting_id : null) + ";\\n" + ${JSON.stringify(browserCode)}).catch(() => {});
  }
`;

const patched = src.slice(0, insertAt) + injected + src.slice(insertAt);
fs.writeFileSync(TARGET, patched, "utf-8");
console.log("[proshop-patch] Parche de subtítulos de Meet aplicado correctamente.");
