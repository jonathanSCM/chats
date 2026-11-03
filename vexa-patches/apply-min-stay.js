#!/usr/bin/env node
// Parche de ProShop CRM sobre el bot de Vexa (dist/aloneness.js): durante los primeros
// BOT_ALONE_MIN_STAY_MS (por defecto 30 min) desde que el bot empieza a vigilar la sala no puede
// irse por "estoy solo", sin importar el silencio. Los BOT_ALONE_SILENCE_WINDOW_MS de silencio
// (hoy 2 min) se cuentan desde el minuto 30 como muy pronto: si la reunión terminó antes, el bot
// espera hasta el minuto 30 y luego esos 2 minutos.
//
// Idempotente y no fatal (ver patch-and-start.sh). Se vuelve a aplicar en cada arranque porque
// parchear la imagen se perdería en cada actualización de Vexa.

const fs = require("fs");

const TARGET = process.argv[2] || "/app/core/meetings/services/bot/dist/aloneness.js";
const MARKER = "__PROSHOP_MIN_STAY_PATCH__";

let src;
try {
  src = fs.readFileSync(TARGET, "utf-8");
} catch (error) {
  console.error(`[proshop-min-stay] No se pudo leer ${TARGET}:`, error.message);
  process.exit(1);
}
if (src.includes(MARKER)) {
  console.log("[proshop-min-stay] Ya estaba parchado -- nada que hacer.");
  process.exit(0);
}

const ANCHOR_A = "let captureFaultRepairAttempted = false;";
const ANCHOR_B = "const snapshot = options.activity.snapshot();";
if (!src.includes(ANCHOR_A) || !src.includes(ANCHOR_B)) {
  console.error("[proshop-min-stay] No se encontraron los anclajes -- Vexa debe haber cambiado de versión. No se aplica; el bot sigue con la regla original.");
  process.exit(0);
}

src = src.replace(
  ANCHOR_A,
  `${ANCHOR_A}\n            /* ${MARKER} */\n            const minStayMs = Number(process.env.BOT_ALONE_MIN_STAY_MS ?? 1800000);\n            const watchStartedAt = now();`,
);
src = src.replace(
  ANCHOR_B,
  `${ANCHOR_B}\n                // El silencio se cuenta como muy pronto desde que termina el tiempo mínimo de permanencia.\n                if (Number.isFinite(minStayMs) && minStayMs > 0 && snapshot.lastRemoteAudioAt !== undefined)\n                    snapshot.lastRemoteAudioAt = Math.max(snapshot.lastRemoteAudioAt, watchStartedAt + minStayMs);`,
);

fs.writeFileSync(TARGET, src);
console.log(`[proshop-min-stay] Parche aplicado: permanencia mínima ${process.env.BOT_ALONE_MIN_STAY_MS ?? 1800000} ms.`);
