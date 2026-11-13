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
  const OWN = "#proshop-captions-badge, #proshop-classify-panel, #proshop-launcher";

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
  // ¿Los subtítulos de Meet están encendidos? El texto (tgaKEf) solo existe mientras alguien habla, así que también se mira la
  // región «Subtítulos» que Meet pone al encenderlos y el estado (aria-pressed) del botón CC de la barra.
  function subsEncendidos() {
    if (hayTextoDeSubs()) return true;
    for (const r of document.querySelectorAll('[role="region"][aria-label]')) {
      if (/^\s*(subt[ií]tulos|captions)\s*$/i.test(r.getAttribute("aria-label") || "")) return true;
    }
    const b = botonBarraCC();
    return Boolean(b && b.getAttribute("aria-pressed") === "true");
  }

  // Solo se apagan al terminar los subtítulos que encendió la extensión: si ya estaban puestos antes, se dejan como estaban.
  let encendimos = false;

  async function activarUnico() {
    if (subsEncendidos()) return true;

    let abierto = false;
    for (let i = 0; i < 28; i++) {
      // ~7 s
      if (abierto && subsEncendidos()) {
        // El botón CC de la barra encendió los subtítulos directamente (sin menú).
        encendimos = true;
        return true;
      }
      const act = buscarBtn(RE_ACTIVAR);
      if (act) {
        log("pulso:", textoBtn(act));
        clicReal(act);
        encendimos = true;
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
    if (abierto) escape();
    if (subsEncendidos()) {
      encendimos = true;
      return true;
    }
    // Último recurso: el atajo de teclado de Meet (C, o Mayús+C), probando cada uno y mirando si se encendieron.
    for (const mayus of [false, true]) {
      const init = { key: mayus ? "C" : "c", code: "KeyC", keyCode: 67, which: 67, shiftKey: mayus, bubbles: true, cancelable: true };
      for (const t of [document.activeElement, document.body]) if (t) t.dispatchEvent(new KeyboardEvent("keydown", init));
      await sleep(800);
      if (subsEncendidos()) {
        encendimos = true;
        return true;
      }
    }
    return false;
  }

  // Apaga los subtítulos de Meet (solo si los encendió la extensión). Misma ruta que al encenderlos, a la inversa.
  async function desactivar() {
    if (!encendimos) return false;
    if (activando) await activando.catch(() => {});
    encendimos = false;
    if (!subsEncendidos()) return false;
    let abierto = false;
    for (let i = 0; i < 16; i++) {
      // ~4 s
      const off = buscarBtn(RE_DESACT);
      if (off) {
        log("pulso:", textoBtn(off));
        clicReal(off);
        await sleep(500);
        escape();
        return true;
      }
      if (abierto && !subsEncendidos()) return true; // el botón CC los apagó directamente
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
    escape();
    return false;
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
    [data-ps-hide="tile"]{ transform:scale(var(--ps-scale,1)) !important; transform-origin:50% 0 !important; }
  `;

  let hidden = false;
  let cap = null;
  let capIsPanel = false;
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
    escalar(main);
  }

  // Meet calcula el tamaño de las cámaras como si los subtítulos siguieran puestos y lo escribe en línea (p. ej. 965x543), y no
  // lo recalcula aunque el escenario crezca: queda una cámara chica con negro debajo. Se agranda el bloque de cámaras (el primer
  // elemento con ancho y alto en línea dentro de main) con una escala para que llene el espacio liberado, pegado arriba y centrado.
  function escalar(main) {
    const candidatos = [...main.querySelectorAll("[style]")].filter((el) => {
      const st = el.getAttribute("style") || "";
      return /width/.test(st) && /height/.test(st) && el.offsetHeight > 150 && el.offsetWidth > 150 && !el.closest(OWN);
    });
    const externos = candidatos.filter((el) => !candidatos.some((o) => o !== el && o.contains(el)));
    // Con una sola cámara hay un único bloque: se agranda. Con varias, cada una es su propio bloque y agrandar una sola la
    // desacomoda (queda cortada): ahí Meet ya reparte las cámaras a lo ancho y no se toca nada.
    const cont = externos.length === 1 ? externos[0] : null;
    for (const o of main.querySelectorAll('[data-ps-hide="tile"]')) if (o !== cont) delete o.dataset.psHide;
    if (!cont) {
      document.documentElement.style.removeProperty("--ps-scale");
      return;
    }
    const s = Math.min(main.clientWidth / cont.offsetWidth, main.clientHeight / cont.offsetHeight);
    if (s > 1.02) {
      touched.add(cont);
      cont.dataset.psHide = "tile";
      document.documentElement.style.setProperty("--ps-scale", Math.min(s, 2).toFixed(4));
    } else {
      delete cont.dataset.psHide;
      document.documentElement.style.removeProperty("--ps-scale");
    }
  }

  function restore() {
    const habia = touched.size > 0;
    for (const node of touched) {
      delete node.dataset.psHide;
      node.style.removeProperty("--ps-bottom");
    }
    touched.clear();
    document.documentElement.style.removeProperty("--ps-scale");
    if (habia) window.dispatchEvent(new Event("resize"));
  }

  function bind(node) {
    if (!node || node === cap) return;
    restore();
    cap = node;
    capIsPanel = false;
    collapse(cap);
  }

  // Sin nadie hablando (o con subtítulos todavía vacíos) no hay texto que encontrar, pero Meet igual reserva el hueco
  // del panel de subtítulos: queda una franja vacía. El panel se reconoce por su estructura (el panel inferior que NO es
  // la barra de controles) y se pliega entero, con o sin texto.
  const CONTROLES =
    'button[aria-label*="Salir de la llamada" i],button[aria-label*="Leave call" i],[role="region"][aria-label*="ontroles" i],[role="region"][aria-label*="ontrols" i]';
  function panelVacio() {
    for (const w of document.querySelectorAll('[data-side="3"]')) {
      if (w.querySelector(CONTROLES)) continue;
      if (w.querySelector(".a4cQT")) return w; // contenedor de subtítulos de Meet: aunque mida poco por fuera, reserva el hueco
      const r = w.getBoundingClientRect();
      if (r.height >= 40 && r.top > window.innerHeight * 0.45) return w;
    }
    return null;
  }
  // Meet reserva el hueco según un hijo de alto fijo (el contenedor de subtítulos, ~216 px), no según el panel de afuera:
  // plegar solo el panel no basta. Se pliegan el panel y todo lo que contiene (el texto sigue en el DOM, a 0 de alto).
  function collapsePanel(w) {
    touched.add(w);
    w.dataset.psHide = "collapse";
    for (const d of w.querySelectorAll("*")) {
      if (d.dataset.psHide) continue;
      touched.add(d);
      d.dataset.psHide = "collapse";
    }
    reclamar();
    for (const ms of [300, 900, 2000]) setTimeout(reclamar, ms);
  }
  function bindPanel(w) {
    if (!w || w === cap) return;
    restore();
    cap = w;
    capIsPanel = true;
    collapsePanel(w);
  }

  let lastObserverRun = 0;
  function startObserver() {
    observer = new MutationObserver(() => {
      if (raf) return;
      // Como mucho una revisión cada 400 ms: Meet cambia su pantalla decenas de veces por segundo y reaccionar a cada cambio
      // (plegar, medir, forzar un nuevo diseño) hacía que la pestaña se trabara.
      const wait = Math.max(0, 400 - (Date.now() - lastObserverRun));
      raf = setTimeout(() => {
        raf = 0;
        lastObserverRun = Date.now();
        if (!hidden) return;
        if (!cap || !document.contains(cap)) {
          const c = buscar();
          if (c) bind(c);
          else bindPanel(panelVacio());
          return;
        }
        if (!cap.dataset.psHide) (capIsPanel ? collapsePanel : collapse)(cap);
        else if (capIsPanel && cap.querySelector(":not([data-ps-hide])")) collapsePanel(cap); // algo nuevo apareció dentro
        else if (Date.now() - ultimoReclamo > 1200) reclamar(); // Meet re-maqueta a menudo
      }, wait);
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
      else bindPanel(panelVacio());
    } else {
      if (observer) observer.disconnect();
      observer = null;
      cap = null;
      capIsPanel = false;
      restore();
      if (styleEl) styleEl.remove();
      styleEl = null;
    }
  }

  window.addEventListener("resize", () => {
    if (hidden && cap) reclamar();
  });

  // Foto de lo que ve la extensión en la pantalla de Meet (para el diagnóstico del panel).
  function describe() {
    const main = document.querySelector("main");
    const panels = [...document.querySelectorAll('[data-side="3"]')].map((w) => {
      const r = w.getBoundingClientRect();
      return `${w.getAttribute("data-priority") || "?"}:${Math.round(r.top)}+${Math.round(r.height)}${w.querySelector(CONTROLES) ? "(barra)" : ""}${w.dataset.psHide ? "[plegado]" : ""}`;
    });
    return JSON.stringify({
      oculto: hidden,
      enganchado: cap ? (capIsPanel ? "panel" : "texto") : "nada",
      tgaKEf: !!document.querySelector('div[jsname="tgaKEf"]'),
      a4cQT: document.querySelectorAll(".a4cQT").length,
      paneles: panels,
      mainAbajo: main ? Math.round(window.innerHeight - main.getBoundingClientRect().bottom) : null,
      mainBottomCss: main ? main.style.bottom || main.style.inset || null : null,
    });
  }

  // Radiografía del hueco entre el escenario (main) y la barra de controles: qué elementos lo ocupan y con qué estilos.
  // Es el dato que hace falta para saber qué pliega Meet y qué no.
  function hueco() {
    const main = document.querySelector("main");
    const barra = document.querySelector(CONTROLES);
    const bw = barra && barra.closest('[data-side="3"]');
    const top = main ? Math.round(main.getBoundingClientRect().bottom) : null;
    const bottom = bw ? Math.round(bw.getBoundingClientRect().top) : window.innerHeight;
    const cadena = (el) => {
      const out = [];
      for (let n = el, i = 0; n && n !== document.body && i < 9; n = n.parentElement, i++) {
        const r = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        out.push(`${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}.${String(n.className || "").split(" ").slice(0, 2).join(".")}[${n.getAttribute("data-side") || ""}${n.getAttribute("jsname") ? " js=" + n.getAttribute("jsname") : ""}] ${Math.round(r.top)}+${Math.round(r.height)} ${cs.position} ${cs.display}${n.dataset.psHide ? " ps=" + n.dataset.psHide : ""}`);
      }
      return out;
    };
    const medio = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round((top + bottom) / 2));
    const ocupantes = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.height < 20 || r.width < 150 || r.bottom <= top || r.top >= bottom || el.closest(OWN)) continue;
      if (ocupantes.length >= 22) break;
      const cs = getComputedStyle(el);
      ocupantes.push(`${el.tagName.toLowerCase()}.${String(el.className || "").split(" ").slice(0, 2).join(".")}[${el.getAttribute("data-side") || ""}] ${Math.round(r.top)}+${Math.round(r.height)} ${cs.position} h=${cs.height} mh=${cs.minHeight}${el.dataset.psHide ? " ps=" + el.dataset.psHide : ""}${el.querySelector("video") ? " VIDEO" : ""}`);
    }
    return JSON.stringify({ ventana: window.innerHeight, mainAbajo: top, barraArriba: bottom, hueco: top == null ? null : bottom - top, enElMedio: medio ? cadena(medio) : null, ocupantes });
  }

  // Dónde guarda Meet el tamaño de las cámaras: elementos con estilo en línea (alto, abajo, arriba…) y la cadena del video.
  function estructura() {
    const main = document.querySelector("main");
    const r2 = (el) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    };
    const etiqueta = (el) => `${el.tagName.toLowerCase()}.${String(el.className || "").split(" ").slice(0, 2).join(".")}${el.getAttribute("jsname") ? "@" + el.getAttribute("jsname") : ""}`;
    const conEstilo = [];
    if (main) {
      for (const el of [main, ...main.querySelectorAll("*")]) {
        const st = el.getAttribute("style");
        if (!st || !/height|bottom|top|inset|width|transform/i.test(st)) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 150 && r.width < 150) continue;
        if (conEstilo.length >= 24) break;
        conEstilo.push(`${etiqueta(el)} [${r2(el)}] style="${st.slice(0, 110)}"${el.dataset.psHide ? " ps=" + el.dataset.psHide : ""}`);
      }
    }
    const vid = document.querySelector("main video, main [data-participant-id], main [data-self-name]");
    const cadena = [];
    for (let n = vid, i = 0; n && n !== document.body && i < 10; n = n.parentElement, i++) cadena.push(`${etiqueta(n)} [${r2(n)}]${n.getAttribute("style") ? " style=" + n.getAttribute("style").slice(0, 80) : ""}`);
    return JSON.stringify({ main: main ? r2(main) + " " + (main.getAttribute("style") || "") : null, conEstilo, cadenaCamara: cadena });
  }

  self.ProShopCaptions = { activate, desactivar, setHidden, isHidden: () => hidden, sleep, describe, hueco, estructura };
})();
