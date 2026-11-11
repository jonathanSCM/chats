// Subtítulos de Meet: activarlos de forma segura y esconder su franja negra.
//
// Lo comparten content.js (que lee los subtítulos) y el resto de la extensión. Dos reglas que evitan los fallos típicos:
//  1. Un solo intento de activación a la vez, y siempre se mira antes si ya estaban activos: un clic de más los APAGA.
//  2. "Esconder" no borra nada: el texto sigue en el DOM (fuera de la vista), así que la lectura de subtítulos no se
//     entera. Se pliega el panel inferior de Meet a 0 de alto y Meet recupera el espacio solo.
(function () {
  "use strict";
  if (self.ProShopCaptions) return;

  const TAG = "[proshop-captions]";
  const log = (...a) => console.log(TAG, ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
  const ICONO = /^[a-z0-9_]+$/; // ligaduras de Material Icons

  const REGION =
    '[role="region"][aria-label*="aption" i],' +
    '[role="region"][aria-label*="ubtítulo" i],' +
    '[role="region"][aria-label*="ubtitulo" i]';
  // Elementos propios de la extensión: nunca se confunden con los subtítulos.
  const OWN = "#proshop-captions-badge, #proshop-classify-panel";

  // ---------- Activar ----------
  const etiqueta = (b) => b.getAttribute("aria-label") || b.getAttribute("data-tooltip") || b.getAttribute("title") || "";
  const textoBtn = (b) => norm(b.textContent) + " " + etiqueta(b);
  function iconoDe(b) {
    const i = b.querySelector('i,[class*="material"],[class*="icon"]');
    return norm((i && i.textContent) || "");
  }
  const visible = (b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const RE_ACTIVAR = /(activar|encender|turn on)\s+(los\s+)?(subt[ií]tulos|captions)/i;
  const RE_DESACT = /(desactivar|apagar|turn off)\s+(los\s+)?(subt[ií]tulos|captions)/i;
  const botones = () => [...document.querySelectorAll('button,[role="button"]')].filter(visible);
  const buscarBtn = (re) => botones().find((b) => re.test(textoBtn(b))) || null;

  function botonBarraCC() {
    const todos = botones();
    const exacto = todos.find((b) => /subt[ií]tulos y traducci[oó]n|captions and translation/i.test(textoBtn(b)) || iconoDe(b) === "translate_cc");
    if (exacto) return exacto;
    return (
      todos.find((b) => {
        if (b.getBoundingClientRect().top < window.innerHeight * 0.75) return false;
        const t = textoBtn(b);
        if (RE_ACTIVAR.test(t) || RE_DESACT.test(t)) return false;
        if (/traducir voz|configur|ajuste|setting|recientes|al final|latest|jump/i.test(t)) return false;
        return /subt[ií]tulo|caption|traduc|translat/i.test(t) || /^(closed_caption(_off)?|subtitles(_off)?|g_translate|translate)$/.test(iconoDe(b));
      }) || null
    );
  }

  // Secuencia completa de eventos de ratón: algunos botones de Google ignoran un click() suelto.
  function clicReal(b) {
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Ev = t.startsWith("pointer") ? PointerEvent : MouseEvent;
      b.dispatchEvent(new Ev(t, { bubbles: true, cancelable: true, button: 0 }));
    }
  }

  function escape() {
    for (const t of [document.activeElement, document]) {
      if (t) t.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  const hayTextoDeSubs = () => !!document.querySelector('div[jsname="tgaKEf"]');

  async function activarUnico() {
    if (hayTextoDeSubs()) return true;
    const tb0 = botonBarraCC();
    if (tb0 && tb0.getAttribute("aria-pressed") === "true") return true;

    let abierto = false;
    for (let i = 0; i < 28; i++) {
      // ~7 s
      const act = buscarBtn(RE_ACTIVAR);
      if (act) {
        log("pulso:", textoBtn(act));
        clicReal(act);
        await sleep(500);
        escape();
        return true;
      }
      if (buscarBtn(RE_DESACT)) {
        escape();
        return true; // ya estaban activos
      }
      if (!abierto) {
        const t = botonBarraCC();
        if (t) {
          clicReal(t);
          abierto = true;
          await sleep(400);
          continue;
        }
      }
      await sleep(250);
    }
    if (abierto) {
      escape();
      return false;
    }
    // Último recurso: la tecla C de Meet.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", keyCode: 67, bubbles: true }));
    await sleep(800);
    return hayTextoDeSubs();
  }

  let activando = null;
  function activate() {
    if (!activando) {
      activando = activarUnico().finally(() => {
        activando = null;
      });
    }
    return activando;
  }

  // ---------- Encontrar el contenedor de subtítulos ----------
  function dentroDelEscenario(el) {
    let n = el.parentElement;
    for (let d = 0; d < 10 && n && n !== document.body; d++) {
      if (n.querySelector("video")) return true;
      n = n.parentElement;
    }
    return false;
  }

  function candidatoHeuristico() {
    const vh = window.innerHeight, vw = window.innerWidth;
    let min = null;
    for (const node of document.querySelectorAll("div,span,p")) {
      if (node.closest('[role="tooltip"]') || node.closest('[aria-label*="hat" i]') || node.closest(OWN)) continue;
      const r = node.getBoundingClientRect();
      if (r.height < 14 || r.width < 20 || r.top < vh * 0.55 || r.left > vw * 0.78) continue;
      if (node.querySelector("video,button")) continue;
      const t = norm(node.textContent);
      if (t.length < 4 || t.length > 400 || ICONO.test(t)) continue;
      if (!dentroDelEscenario(node)) continue;
      const area = r.width * r.height;
      if (!min || area < min.area) min = { node, area };
    }
    if (!min) return null;
    let n = min.node;
    for (let d = 0; d < 6; d++) {
      const par = n.parentElement;
      if (!par || par === document.body || par.querySelector("video")) break;
      const pr = par.getBoundingClientRect();
      if (pr.top < vh * 0.4 || pr.height > vh * 0.6 || !norm(par.textContent)) break;
      n = par;
    }
    return n;
  }

  function valido(node) {
    if (!node || !node.isConnected) return false;
    if (node.closest('[role="dialog"],[role="tooltip"],[role="alertdialog"]') || node.closest(OWN)) return false;
    if (node.querySelector("video")) return false;
    const r = node.getBoundingClientRect();
    if (r.height < 10 || r.width < 20 || r.top < window.innerHeight * 0.45) return false;
    const t = norm(node.textContent);
    if (!t) return false;
    // La tarjeta de bienvenida / enlace de la reunión nunca son subtítulos.
    if (/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}|Copiar v[ií]nculo|Copy (joining )?(link|info)|Agrega otras personas|Add others/i.test(t)) return false;
    return true;
  }

  function buscar() {
    for (const sel of ['div[jsname="tgaKEf"]', REGION]) {
      for (const node of document.querySelectorAll(sel)) if (valido(node)) return node;
    }
    const h = candidatoHeuristico();
    return valido(h) ? h : null;
  }

  // ---------- Esconder la franja ----------
  const CSS = `
    [data-ps-hide="leaf"]{
      position:fixed !important; left:-10000px !important; top:0 !important;
      width:100vw !important; height:auto !important; max-height:none !important;
      min-height:0 !important; margin:0 !important; padding:0 !important;
      border:0 !important; pointer-events:none !important;
    }
    [data-ps-hide="collapse"]{
      height:0 !important; min-height:0 !important; max-height:0 !important;
      padding:0 !important; margin:0 !important; border-width:0 !important;
      overflow:hidden !important; flex:0 0 0 !important; gap:0 !important;
    }
    main[data-ps-hide="stage"]{ bottom:var(--ps-bottom) !important; }
  `;

  let hidden = false;
  let cap = null;
  let observer = null;
  let raf = 0;
  let styleEl = null;
  let ultimoReclamo = 0;
  const touched = new Set();

  function panelSubs(node) {
    const w = node.closest('[data-side="3"]');
    if (!w) return null;
    if (w.querySelector('button[aria-label*="Salir de la llamada" i],button[aria-label*="Leave call" i],[role="region"][aria-label*="ontroles" i],[role="region"][aria-label*="ontrols" i]')) return null;
    return w;
  }

  function centro() {
    return document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight * 0.35));
  }

  function collapse(node) {
    touched.add(node);
    node.dataset.psHide = "leaf";
    let par = node.parentElement;
    const w = panelSubs(node);
    if (w) {
      while (par && par !== document.body) {
        touched.add(par);
        par.dataset.psHide = "collapse";
        if (par === w) break;
        par = par.parentElement;
      }
    } else {
      const c = centro();
      while (par && par !== document.body && !(c && par.contains(c))) {
        if (par.querySelector("button")) break;
        touched.add(par);
        par.dataset.psHide = "collapse";
        par = par.parentElement;
      }
    }
    reclamar();
    for (const ms of [300, 900, 2000]) setTimeout(reclamar, ms);
  }

  function reclamar() {
    if (!hidden || !cap) return;
    ultimoReclamo = Date.now();
    const main = document.querySelector("main");
    if (!main) return;
    const w = cap.closest && cap.closest('[data-side="3"]');
    let topBarra = window.innerHeight, hay = false;
    for (const o of document.querySelectorAll('[data-side="3"]')) {
      if (o === w) continue;
      const r = o.getBoundingClientRect();
      if (r.height > 0) {
        hay = true;
        if (r.top < topBarra) topBarra = r.top;
      }
    }
    if (!hay) return;
    const hueco = topBarra - main.getBoundingClientRect().bottom;
    if (main.dataset.psHide !== "stage" && hueco <= 40) return;
    const bottom = Math.max(0, Math.round(window.innerHeight - topBarra + 8));
    const antes = parseInt(main.style.getPropertyValue("--ps-bottom"), 10);
    touched.add(main);
    main.dataset.psHide = "stage";
    main.style.setProperty("--ps-bottom", bottom + "px");
    if (antes !== bottom) window.dispatchEvent(new Event("resize")); // para que Meet recoloque las cámaras
  }

  function restore() {
    const habia = touched.size > 0;
    for (const node of touched) {
      delete node.dataset.psHide;
      node.style.removeProperty("--ps-bottom");
    }
    touched.clear();
    if (habia) window.dispatchEvent(new Event("resize"));
  }

  function bind(node) {
    if (!node || node === cap) return;
    restore();
    cap = node;
    collapse(cap);
  }

  function startObserver() {
    observer = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!hidden) return;
        if (!cap || !document.contains(cap)) {
          const c = buscar();
          if (c) bind(c);
          return;
        }
        if (cap.dataset.psHide !== "leaf") collapse(cap);
        else if (Date.now() - ultimoReclamo > 1200) reclamar(); // Meet re-maqueta a menudo
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Esconde (true) o vuelve a mostrar (false) la franja de subtítulos de Meet.
  function setHidden(value) {
    if (value === hidden) return;
    hidden = value;
    if (hidden) {
      styleEl = document.createElement("style");
      styleEl.id = "proshop-captions-style";
      styleEl.textContent = CSS;
      document.head.append(styleEl);
      startObserver();
      const c = buscar();
      if (c) bind(c);
    } else {
      if (observer) observer.disconnect();
      observer = null;
      cap = null;
      restore();
      if (styleEl) styleEl.remove();
      styleEl = null;
    }
  }

  window.addEventListener("resize", () => {
    if (hidden && cap) reclamar();
  });

  self.ProShopCaptions = { activate, setHidden, isHidden: () => hidden, sleep };
})();
