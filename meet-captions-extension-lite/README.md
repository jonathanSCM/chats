# ProShop CRM — Subtítulos de Meet (versión sin audio)

Copia de `meet-captions-extension/` pensada para la Chrome Web Store: **solo guarda los subtítulos** de Meet en el CRM.
No usa micrófono, ni `tabCapture`, ni `offscreen`, ni `desktopCapture`; sus permisos son solo `storage` y `sidePanel`.

- Misma sesión del CRM (`authorize-bridge.js`), mismo selector de organización y mismo envío (`/api/extension/...`) que la extensión completa.
- El ícono abre un popup con «Nueva reunión» (meet.new), «Unirse con enlace o código» y «Abrir Google Meet»; dentro de una reunión abre el panel.
- Sin «Unir al asistente», sin «Actualizar ahora» (la tienda actualiza sola).
- Siempre manda `audioOff: true`, así el servidor sabe que no habrá audio.
- Versión propia (empieza en 1.0.0). Los cambios de lectura de subtítulos (`captions-dom.js`, `content.js`) hay que llevarlos a mano desde la extensión completa.

Empaquetar para la tienda: `npx tsx scripts/build-extension-lite-zip.ts <carpeta>`.
