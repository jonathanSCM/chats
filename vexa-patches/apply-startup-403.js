#!/usr/bin/env node
// Parche de ProShop CRM sobre el bot de Vexa (modules/join/dist/googlemeet/join.js).
//
// Problema (observado el 12-nov-2026 en el servidor): a veces Google responde 403 «The caller does not have permission» al
// ARRANQUE de Meet (startupCode 200). La página queda muerta, sin botones, y ~70 s después Meet la manda a su página de
// inicio; el bot toma el cuadro «código de reunión» por el campo de nombre y termina esperando hasta que alguien lo detiene.
// Pasa al azar (11 de las últimas 40 sesiones): la misma sala falla y minutos después entra sin problema.
//
// Con este parche el bot corta ese intento en ~12 s si la pantalla de unión no aparece (o si la página ya no es la de la
// reunión) y falla con un motivo claro. Se clasifica como «never_reached_lobby» (no llegó a la sala), que el CRM reintenta solo
// con un bot nuevo. La señal es la AUSENCIA de la pantalla de unión, no el texto del error: el texto del 403 no llega como
// mensaje de consola ni como error de la página (la primera versión de este parche lo buscaba ahí y no lo veía).
//
// Idempotente y no fatal (ver patch-and-start.sh). Si Vexa cambia de versión y no encuentra los anclajes, no toca nada.
// Reemplaza la versión 1 de este parche si la encuentra. Uso: node apply-startup-403.js <carpeta join/dist>
//   (por defecto /app/core/meetings/modules/join/dist)

const fs = require("fs");
const path = require("path");

const DIST = process.argv[2] || "/app/core/meetings/modules/join/dist";
const JOIN = path.join(DIST, "googlemeet", "join.js");
const V1 = "__PROSHOP_STARTUP_403_PATCH__";
const VN = /__PROSHOP_STARTUP_403_V\d__/;
const MARKER = "__PROSHOP_STARTUP_403_V4__";

let src;
try {
  src = fs.readFileSync(JOIN, "utf-8");
} catch (error) {
  console.error(`[proshop-startup-403] No se pudo leer ${JOIN}:`, error.message);
  process.exit(1);
}
if (src.includes(MARKER)) {
  console.log("[proshop-startup-403] Ya estaba parchado (v4) -- nada que hacer.");
  process.exit(0);
}

// Versiones anteriores: se quitan antes de poner la nueva (el contenedor conserva los archivos parchados entre reinicios).
//  v1: escuchaba el texto del 403 en la consola (no llega ahí). v2: daba por buena cualquier pantalla con un botón «Ask to join»
//  (el esqueleto de la página lo tiene unos segundos aunque Meet ya haya fallado). v3: miraba que el campo de nombre EXISTIERA,
//  pero en la página muerta existe oculto: hay que mirar que esté VISIBLE (como hace el propio Vexa al buscarlo).
if (src.includes(V1) || VN.test(src)) {
  const before = src;
  src = src
    .replace(/ {4}\/\* __PROSHOP_STARTUP_403_PATCH__ \*\/\n {4}let __psStartup403[\s\S]*?(?= {4}await page\.goto\(navUrl)/, "")
    .replace(/ {4}\/\* __PROSHOP_STARTUP_403_PATCH__ \*\/\n {4}\/\/ Hasta[\s\S]*?pre-join screen never appeared"\);\n {4}\}\n/, "")
    .replace(/ {4}\/\* __PROSHOP_STARTUP_403_V\d__ \*\/\n[\s\S]*?pre-join screen never appeared"\);\n {8}\}\n {4}\}\n/, "");
  if (src.includes(V1) || VN.test(src) || src === before) {
    console.error("[proshop-startup-403] No se pudo quitar una versión anterior del parche -- no se aplica la nueva.");
    process.exit(0);
  }
}

const LOCALE = "    (0, _host_1.log)(`Lobby locale (#856): ${await observedPageContext(page)}`);";
if (!src.includes(LOCALE)) {
  console.error("[proshop-startup-403] No se encontró el anclaje (idioma de la sala) -- Vexa debe haber cambiado de versión. No se aplica.");
  process.exit(0);
}

const CHECK = `${LOCALE}
    /* ${MARKER} */
    // Hasta ~12 s por el CAMPO DE NOMBRE de la pantalla de unión (en un arranque sano aparece a los 3-4 s). Si no aparece (Meet
    // respondió 403 al arrancar y la página quedó muerta) o la página ya no es la de la reunión, se falla ya: el CRM reintenta
    // con un bot nuevo. No sirve mirar los botones: el esqueleto de la página ya trae «Ask to join» aunque el arranque falle.
    if (!botConfig.authenticated) {
        const __psCode = (String(navUrl).match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/) || [])[0];
        let __psUi = false;
        for (let __psI = 0; __psI < 24; __psI++) {
            if (__psCode && !page.url().includes(__psCode))
                break;
            const __psInput = await page.$('input[jsname][type="text"], input[type="text"][aria-label="Your name"]');
            if (__psInput && (await __psInput.isVisible().catch(() => false))) {
                __psUi = true;
                break;
            }
            await page.waitForTimeout(500);
        }
        if (!__psUi) {
            try {
                await page.screenshot({ path: '/app/storage/screenshots/bot-checkpoint-startup-403.png', fullPage: true });
            }
            catch { }
            (0, _host_1.log)(\`Google Meet no mostró la pantalla de unión (arranque rechazado, 403): url=\${page.url()}. Se corta para reintentar con un bot nuevo.\`);
            throw new Error("Google Meet startup rejected the bot (403 The caller does not have permission): the pre-join screen never appeared");
        }
    }`;

fs.writeFileSync(JOIN, src.replace(LOCALE, () => CHECK));
console.log("[proshop-startup-403] Parche v4 aplicado: si Meet no muestra el campo de nombre en ~12 s, la entrada falla enseguida.");
