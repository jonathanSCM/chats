#!/usr/bin/env node
// Parche de ProShop CRM sobre el bot de Vexa: capturas de pantalla del asistente mientras entra a Meet.
//
// Vexa ya saca capturas, pero con nombre fijo (cada una pisa a la anterior), solo en pocos momentos y sin
// ninguna forma de pedirlas. Este parche manda al CRM una captura (JPG liviano) con la URL y el título de la
// página en: la sala de espera, cada ~2 min mientras espera, 1 min antes de que se acabe el tiempo, al agotarlo,
// al abrir el link y cuando no encuentra el botón de unirse. El CRM las guarda 7 días y las muestra en la
// reunión: si la captura muestra la sala de espera, falta que lo admitan; si muestra otra cosa, algo falló.
//
// Idempotente y no fatal (ver patch-and-start.sh). Se vuelve a aplicar en cada arranque porque parchear la
// imagen se perdería en cada actualización de Vexa. Usa las mismas variables que el parche de subtítulos.

const fs = require("fs");
const path = require("path");

const JOIN_DIR = process.argv[2] || "/app/core/meetings/modules/join/dist";
const MARKER = "__PROSHOP_SHOTS_PATCH__";
const appUrl = (process.env.PROSHOP_APP_URL || "").replace(/\/$/, "");
const token = process.env.PROSHOP_MEET_CAPTIONS_TOKEN || "";

if (!appUrl || !token) {
  console.warn("[proshop-shots] PROSHOP_APP_URL/PROSHOP_MEET_CAPTIONS_TOKEN no configurados -- se omite el parche.");
  process.exit(0);
}

const helperSource = `"use strict";
// ${MARKER} (generado por vexa-patches/apply-shots.js)
const APP_URL = ${JSON.stringify(appUrl)};
const TOKEN = ${JSON.stringify(token)};
const MAX_SHOTS = 14; // por sesión: una reunión nunca manda más que esto
let sent = 0;
const doneMarks = new Set();
let invocation = null;

function inv() {
  if (invocation) return invocation;
  try { invocation = JSON.parse(process.env.VEXA_BOT_CONFIG || "{}"); } catch { invocation = {}; }
  return invocation;
}

async function shot(page, label) {
  if (sent >= MAX_SHOTS) return;
  sent++;
  try {
    const image = await Promise.race([
      page.screenshot({ type: "jpeg", quality: 55 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout de la captura")), 8000)),
    ]);
    let pageUrl = "";
    let pageTitle = "";
    try { pageUrl = page.url(); } catch {}
    try { pageTitle = await page.title(); } catch {}
    const c = inv();
    const res = await fetch(APP_URL + "/api/webhooks/meeting-bot-shot", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify({
        sessionId: typeof c.meeting_id === "number" ? c.meeting_id : null,
        nativeMeetingId: c.nativeMeetingId || null,
        label,
        pageUrl,
        pageTitle,
        image: image.toString("base64"),
      }),
      signal: AbortSignal.timeout(10000),
    });
    console.log(JSON.stringify({ level: "info", msg: "proshop-shots: " + label + " -> " + res.status }));
  } catch (e) {
    console.log(JSON.stringify({ level: "warn", msg: "proshop-shots: no se pudo mandar '" + label + "': " + (e && e.message) }));
  }
}

// Llamada en cada vuelta del bucle de espera: saca la captura cuando se cruza cada marca de tiempo.
async function tick(page, elapsedMs, timeoutMs) {
  const marks = [60000];
  for (let t = 180000; t < timeoutMs - 60000; t += 120000) marks.push(t);
  marks.push(Math.max(0, timeoutMs - 60000));
  for (const mark of marks) {
    if (elapsedMs >= mark && !doneMarks.has(mark)) {
      doneMarks.add(mark);
      await shot(page, "esperando-" + Math.round(mark / 1000) + "s");
      return;
    }
  }
}

module.exports = { shot, tick };
`;

/** Agrega `addition` en una línea nueva justo después de la línea que contiene `needle` (misma sangría). */
function insertAfterLine(src, needle, addition) {
  const idx = src.indexOf(needle);
  if (idx === -1) return null;
  if (src.indexOf(needle, idx + needle.length) !== -1) return null; // ancla ambigua: no se toca
  const lineStart = src.lastIndexOf("\n", idx) + 1;
  const lineEnd = src.indexOf("\n", idx);
  const line = src.slice(lineStart, lineEnd);
  const indent = line.match(/^\s*/)[0];
  return src.slice(0, lineEnd + 1) + `${indent}${addition}\n` + src.slice(lineEnd + 1);
}

function patchFile(file, requireLine, edits) {
  let src = fs.readFileSync(file, "utf-8");
  if (src.includes(MARKER)) return "ya";
  for (const [needle] of edits) {
    if (insertAfterLine(src, needle, "x") === null) {
      console.error(`[proshop-shots] No se encontró el ancla en ${path.basename(file)}: ${needle.slice(0, 60)} -- Vexa debe haber cambiado de versión. No se parchea este archivo.`);
      return "sin-ancla";
    }
  }
  for (const [needle, addition] of edits) src = insertAfterLine(src, needle, addition);
  // Después del "use strict" (o al principio) va el require del helper, junto con el marcador.
  const header = `/* ${MARKER} */ const __ps = require(${JSON.stringify(requireLine)});\n`;
  src = /^"use strict";\r?\n/.test(src) ? src.replace(/^("use strict";\r?\n)/, `$1${header}`) : header + src;
  fs.writeFileSync(file, src);
  return "aplicado";
}

try {
  const googlemeet = path.join(JOIN_DIR, "googlemeet");
  fs.writeFileSync(path.join(JOIN_DIR, "_proshop-shot.js"), helperSource);

  const admission = patchFile(path.join(googlemeet, "admission.js"), "../_proshop-shot", [
    ["Screenshot taken: Bot confirmed in waiting room", 'await __ps.shot(page, "en-la-sala-de-espera");'],
    ["Still in Google Meet waiting room...", "await __ps.tick(page, Date.now() - startTime, timeout);"],
    ["Polling for Google Meet admission...", "await __ps.tick(page, Date.now() - startTime, timeout);"],
    ["bot-checkpoint-3-no-indicators.png", 'await __ps.shot(page, "al-agotar-el-tiempo");'],
  ]);
  const join = patchFile(path.join(googlemeet, "join.js"), "../_proshop-shot", [
    ["bot-checkpoint-0-after-navigation.png", 'await __ps.shot(page, "despues-de-abrir-el-link");'],
    ["Screenshot: ${label} not found by any of", 'await __ps.shot(page, "no-se-encontro-" + label);'],
  ]);
  console.log(`[proshop-shots] admission.js: ${admission}; join.js: ${join}`);
} catch (error) {
  console.error("[proshop-shots] No se pudo aplicar el parche (no fatal):", error.message);
  process.exit(0);
}
