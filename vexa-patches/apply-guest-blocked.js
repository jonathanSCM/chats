#!/usr/bin/env node
// Parche de ProShop CRM sobre el bot de Vexa (modules/join/dist/googlemeet/{selectors,admission}.js).
//
// Problema: cuando Meet no deja entrar a un invitado anónimo (reunión de una cuenta de Google Workspace que no
// admite invitados, o restringida por el anfitrión) muestra "You can't join this VIDEO call" y a los 60 s lo manda a su
// página de inicio. Vexa solo conoce el texto "can't join this call" (sin "video"), así que no lo reconoce y sigue
// diciendo "esperando que lo admitan" -- el CRM se entera recién por una captura, ~75 s después.
//
// Con este parche Vexa reconoce el texto, termina la sesión como "rechazado" a los pocos segundos y deja un motivo propio
// ("guest_blocked") en el detalle, que el CRM lee para explicarlo como bloqueo de Meet y no como rechazo del anfitrión.
//
// Idempotente y no fatal (ver patch-and-start.sh). Si Vexa cambia de versión y no encuentra los anclajes, no toca nada.
// Uso: node apply-guest-blocked.js <carpeta join/dist>   (por defecto /app/core/meetings/modules/join/dist)

const fs = require("fs");
const path = require("path");

const DIST = process.argv[2] || "/app/core/meetings/modules/join/dist";
const SELECTORS = path.join(DIST, "googlemeet", "selectors.js");
const ADMISSION = path.join(DIST, "googlemeet", "admission.js");
const MARKER = "__PROSHOP_GUEST_BLOCKED_PATCH__";

function read(file) {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch (error) {
    console.error(`[proshop-guest-blocked] No se pudo leer ${file}:`, error.message);
    process.exit(1);
  }
}

const selectors = read(SELECTORS);
const admission = read(ADMISSION);
if (selectors.includes(MARKER) && admission.includes(MARKER)) {
  console.log("[proshop-guest-blocked] Ya estaba parchado -- nada que hacer.");
  process.exit(0);
}

// 1) selectors.js: el texto que Meet muestra de verdad.
const SEL_ANCHOR = "    'text=can’t join this call', // typographic apostrophe (live Meet copy)";
// 2) admission.js: es una negativa explícita (gana a cualquier captcha), con motivo propio y mensaje claro.
const ADM_ANCHOR_COPY = '    "not allowed to join",\n';
const ADM_ANCHOR_VERDICT = 'return { rejected: true, reason: "host_denial", selector };';
const ADM_ANCHOR_MESSAGE = '    host_denial: "Bot admission was rejected by meeting admin",\n';

const missing = [
  [selectors, SEL_ANCHOR, "selectors"],
  [admission, ADM_ANCHOR_COPY, "lista de negativas"],
  [admission, ADM_ANCHOR_VERDICT, "veredicto"],
  [admission, ADM_ANCHOR_MESSAGE, "mensajes"],
].filter(([src, anchor]) => !src.includes(anchor));
if (missing.length > 0) {
  console.error(
    `[proshop-guest-blocked] No se encontraron los anclajes (${missing.map((m) => m[2]).join(", ")}) -- Vexa debe haber cambiado de versión. No se aplica.`,
  );
  process.exit(0);
}

const newSelectors = selectors.replace(
  SEL_ANCHOR,
  `${SEL_ANCHOR}\n    /* ${MARKER} */\n    'text=can’t join this video call',\n    "text=can't join this video call",`,
);

const newAdmission = admission
  .replace(
    ADM_ANCHOR_COPY,
    `${ADM_ANCHOR_COPY}    /* ${MARKER} */\n    "can’t join this video call",\n    "can't join this video call",\n`,
  )
  .replace(
    ADM_ANCHOR_VERDICT,
    'return { rejected: true, reason: /video call/i.test(selector) ? "guest_blocked" : "host_denial", selector };',
  )
  .replace(
    ADM_ANCHOR_MESSAGE,
    `${ADM_ANCHOR_MESSAGE}    guest_blocked: "Google Meet blocked the guest: You can't join this video call (the host or its Google Workspace does not allow anonymous guests)",\n`,
  );

fs.writeFileSync(SELECTORS, newSelectors);
fs.writeFileSync(ADMISSION, newAdmission);
console.log("[proshop-guest-blocked] Parche aplicado: «You can't join this video call» ahora termina la sesión como bloqueo de invitado.");
