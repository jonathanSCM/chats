/**
 * Aviso para navegadores viejos. La app (Next.js 16 y Tailwind 4) solo
 * soporta oficialmente Chrome/Edge 111+, Firefox 111+ y Safari 16.4+. En un
 * celular antiguo (por ejemplo un Samsung J7 que se quedó con Android 6 o 7)
 * el navegador o el "Android System WebView" pueden ser más viejos y la app se
 * ve mal o se cierra, sin ninguna explicación. Este script se ejecuta ANTES de
 * la app, está escrito en ES5 a propósito (lo debe entender cualquier
 * navegador) y, si falta alguna función necesaria, muestra una barra con qué
 * hacer. No bloquea nada.
 */
export const LEGACY_BROWSER_NOTICE_SCRIPT = `
(function () {
  try {
    var ok = true;
    try { ok = !!(window.CSS && CSS.supports && CSS.supports("color", "color-mix(in srgb, red, blue)")); } catch (e) { ok = false; }
    if (ok && typeof Array.prototype.at !== "function") ok = false;
    if (ok && typeof Object.hasOwn !== "function") ok = false;
    if (ok) return;
    window.__legacyBrowser = true;
    function show() {
      if (document.getElementById("legacy-browser-notice")) return;
      var bar = document.createElement("div");
      bar.id = "legacy-browser-notice";
      bar.setAttribute("role", "alert");
      bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#fef3c7;color:#451a03;font:14px/1.4 sans-serif;padding:12px 44px 12px 14px;box-shadow:0 -2px 12px rgba(0,0,0,.25)";
      bar.appendChild(document.createTextNode("Tu navegador es muy antiguo y la app puede verse mal o cerrarse. Actualiza Chrome y \\u00abAndroid System WebView\\u00bb desde Play Store (se necesita la versi\\u00f3n 111 o mayor)."));
      var close = document.createElement("button");
      close.type = "button";
      close.setAttribute("aria-label", "Cerrar");
      close.appendChild(document.createTextNode("\\u00d7"));
      close.style.cssText = "position:absolute;right:8px;top:6px;border:0;background:none;font-size:26px;line-height:1;color:#451a03";
      close.onclick = function () { if (bar.parentNode) bar.parentNode.removeChild(bar); };
      bar.appendChild(close);
      document.body.appendChild(bar);
    }
    if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
  } catch (e) {}
})();
`;
