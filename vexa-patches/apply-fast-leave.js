#!/usr/bin/env node
// Parche de ProShop CRM sobre el bot de Vexa (services/bot/dist/{capture-bridge,aloneness}.js): salir rápido cuando el asistente
// se queda SOLO en la reunión.
//
// Problema: Vexa decide «estoy solo» por SILENCIO de audio (2 min) y nuestro parche apply-min-stay.js además lo obliga a quedarse
// 30 min como mínimo. Si todos se van a los 10 minutos, el asistente sigue en la reunión hasta el minuto 32.
//
// Solución: se mira cuánta gente hay de verdad. Cada 3 s el bot lee el número del botón «Personas» de Meet. Sale cuando:
//   1) antes llegó a ver al menos 2 personas (es decir, hubo alguien más además de él), y
//   2) ahora ve 1 (solo él) de forma continua durante BOT_ALONE_PEOPLE_CONFIRM_MS (por defecto 20 s), con una lectura fresca.
// Si no se puede leer el número (Meet cambió el botón) NO se hace nada: queda la regla de silencio de antes. Un asistente que
// llega primero y espera al anfitrión tampoco sale (nunca vio a nadie más).
// Para apagarlo: BOT_ALONE_PEOPLE=0.
//
// Requiere apply-min-stay.js aplicado antes (se engancha a su línea). Idempotente y no fatal (ver patch-and-start.sh).
// Uso: node apply-fast-leave.js <carpeta services/bot/dist>   (por defecto /app/core/meetings/services/bot/dist)

const fs = require("fs");
const path = require("path");

const DIST = process.argv[2] || "/app/core/meetings/services/bot/dist";
const BRIDGE = path.join(DIST, "capture-bridge.js");
const ALONE = path.join(DIST, "aloneness.js");
const MARKER = "__PROSHOP_FAST_LEAVE_PATCH__";

function read(file) {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch (error) {
    console.error(`[proshop-fast-leave] No se pudo leer ${file}:`, error.message);
    process.exit(1);
  }
}

const bridge = read(BRIDGE);
const alone = read(ALONE);
if (bridge.includes(MARKER) && alone.includes(MARKER)) {
  console.log("[proshop-fast-leave] Ya estaba parchado -- nada que hacer.");
  process.exit(0);
}

// capture-bridge.js: después de registrar __vexaStreamPresence, un lector del número de personas (corre solo para Meet).
const BRIDGE_ANCHOR = "    // jitsi chat → the embedder's sink (a transcript.v1 `chat` segment at the composition root).";
// aloneness.js: justo después de la línea que agrega el parche de permanencia mínima.
const ALONE_ANCHOR = "snapshot.lastRemoteAudioAt = Math.max(snapshot.lastRemoteAudioAt, watchStartedAt + minStayMs);";

const missing = [
  [bridge, BRIDGE_ANCHOR, "capture-bridge"],
  [alone, ALONE_ANCHOR, "aloneness (¿falta apply-min-stay?)"],
].filter(([src, anchor]) => !src.includes(anchor));
if (missing.length > 0) {
  console.error(`[proshop-fast-leave] No se encontraron los anclajes (${missing.map((m) => m[2]).join(", ")}) -- Vexa debe haber cambiado de versión. No se aplica.`);
  process.exit(0);
}

const READER = `    /* ${MARKER} */
    // Lector del número de personas de Meet (cada 3 s). Guarda { count, at } en globalThis.__psPeople; aloneness.js lo usa.
    if (process.env.BOT_ALONE_PEOPLE !== "0" && inv.platform === "google_meet") {
        const __psTimer = setInterval(async () => {
            try {
                if (page.isClosed()) {
                    clearInterval(__psTimer);
                    return;
                }
                const found = await page.evaluate(() => {
                    const buttons = Array.from(globalThis.document.querySelectorAll("button"));
                    for (const b of buttons) {
                        const label = b.getAttribute("aria-label") || "";
                        if (!/people|participants|everyone|personas/i.test(label)) continue;
                        const m = (b.textContent || "").match(/\\d+/) || label.match(/\\d+/);
                        if (m) return { count: Number(m[0]), label: label.slice(0, 40) };
                    }
                    return null;
                });
                const prev = globalThis.__psPeople;
                if (found && Number.isFinite(found.count)) {
                    globalThis.__psPeople = { count: found.count, at: Date.now() };
                    if (!prev || prev.count !== found.count) console.log("[proshop-people] participantes=" + found.count + ' (botón: "' + found.label + '")');
                }
            }
            catch { }
        }, 3000);
    }
`;

const GATE = `${ALONE_ANCHOR}
                /* ${MARKER} */
                // Salida rápida por presencia: hubo alguien más y ahora solo queda el asistente de forma continua.
                if (process.env.BOT_ALONE_PEOPLE !== "0") {
                    const __ps = globalThis.__psPeople;
                    if (__ps && at - __ps.at < 15000) {
                        if (__ps.count >= 2)
                            globalThis.__psSawOthers = true;
                        if (__ps.count <= 1) {
                            if (!globalThis.__psAloneSince)
                                globalThis.__psAloneSince = at;
                        }
                        else {
                            globalThis.__psAloneSince = 0;
                        }
                    }
                    else {
                        globalThis.__psAloneSince = 0; // lectura vieja o ausente: no se decide por presencia
                    }
                    const __psConfirm = Number(process.env.BOT_ALONE_PEOPLE_CONFIRM_MS ?? 20000);
                    if (globalThis.__psSawOthers && globalThis.__psAloneSince && at - globalThis.__psAloneSince >= __psConfirm) {
                        if (!globalThis.__psAloneLogged) {
                            globalThis.__psAloneLogged = true;
                            log("aloneness: solo queda el asistente (personas=" + (__ps && __ps.count) + ", hace " + Math.round((at - globalThis.__psAloneSince) / 1000) + " s) -- sale sin esperar la permanencia mínima ni el silencio");
                        }
                        snapshot.lastRemoteAudioAt = at - options.windowMs - 1;
                    }
                }`;

fs.writeFileSync(BRIDGE, bridge.replace(BRIDGE_ANCHOR, () => `${READER}${BRIDGE_ANCHOR}`));
fs.writeFileSync(ALONE, alone.replace(ALONE_ANCHOR, () => GATE));
console.log("[proshop-fast-leave] Parche aplicado: el asistente sale ~20 s después de quedarse solo (si antes vio a otra persona).");
