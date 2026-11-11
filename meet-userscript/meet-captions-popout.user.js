// ==UserScript==
// @name         Meet Captions Pop-out (v14)
// @namespace    venice.test
// @version      0.14
// @description  Activa los subtítulos de Meet, los saca a una ventana flotante y elimina la franja negra
// @match        https://meet.google.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const TAG = '[pop-subs]';
  const log = (...a) => console.log(TAG, ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let pip = null, out = null, cap = null, mo = null, raf = 0, vacioDesde = 0;
  let yoActiveLosSubs = false;
  const touched = new Set();

  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const ICONO = /^[a-z0-9_]+$/;               // ligaduras de Material Icons
  const ICONO_LINEA = /^[a-z]+(_[a-z]+)+$/;   // p.ej. arrow_downward

  // Región oficial de subtítulos de Meet (EN/ES). Es el mejor candidato.
  const REGION =
    '[role="region"][aria-label*="aption" i],' +
    '[role="region"][aria-label*="ubtítulo" i],' +
    '[role="region"][aria-label*="ubtitulo" i]';

  // ---------- 1) Activar subtítulos de Meet ----------
  // En este Meet el botón de la barra (icono de traducción) abre un panel con
  // "Activar subtítulos" / "Traducir voz" / engranaje. Hay que pulsar el de dentro.

  const etiqueta = b =>
    b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || b.getAttribute('title') || '';
  const textoBtn = b => norm(b.textContent) + ' ' + etiqueta(b);

  function iconoDe(b) {
    const i = b.querySelector('i,[class*="material"],[class*="icon"]');
    return norm(i?.textContent || '');
  }

  const visible = b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  const RE_ACTIVAR = /(activar|encender|turn on)\s+(los\s+)?(subt[ií]tulos|captions)/i;
  const RE_DESACT  = /(desactivar|apagar|turn off)\s+(los\s+)?(subt[ií]tulos|captions)/i;

  const botones = () => [...document.querySelectorAll('button,[role="button"]')]
    .filter(b => b.id !== 'pop-subs-btn' && visible(b));

  const buscarBtn = re => botones().find(b => re.test(textoBtn(b))) || null;

  // El botón de la barra de abajo que abre el panel de subtítulos/traducción.
  // En Meet se llama "Subtítulos y traducción" (icono translate_cc) y marca aria-pressed.
  function botonBarraCC() {
    const todos = botones();
    const exacto = todos.find(b => /subt[ií]tulos y traducci[oó]n|captions and translation/i.test(textoBtn(b)) ||
                                   iconoDe(b) === 'translate_cc');
    if (exacto) return exacto;
    return todos.find(b => {
      if (b.getBoundingClientRect().top < innerHeight * 0.75) return false;
      const t = textoBtn(b);
      if (RE_ACTIVAR.test(t) || RE_DESACT.test(t)) return false;
      if (/traducir voz|configur|ajuste|setting|recientes|al final|latest|jump/i.test(t)) return false;
      return /subt[ií]tulo|caption|traduc|translat/i.test(t) ||
             /^(closed_caption(_off)?|subtitles(_off)?|g_translate|translate)$/.test(iconoDe(b));
    }) || null;
  }

  // Secuencia completa de eventos de ratón: algunos botones de Google ignoran un click() suelto.
  function clicReal(b) {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ev = t.startsWith('pointer') ? PointerEvent : MouseEvent;
      b.dispatchEvent(new Ev(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
    }
  }

  function escape() {
    for (const t of [document.activeElement, document]) {
      t?.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
    document.activeElement?.blur?.();
  }

  const hayTextoDeSubs = () => !!document.querySelector('div[jsname="tgaKEf"]');

  async function activarSubs() {
    if (hayTextoDeSubs()) return true;                    // ya hay subtítulos en pantalla
    const tb0 = botonBarraCC();
    if (tb0 && tb0.getAttribute('aria-pressed') === 'true') {
      log('los subtítulos ya estaban activos (botón pulsado)');
      return true;
    }

    let abierto = false;
    for (let i = 0; i < 28; i++) {                        // ~7 s
      const act = buscarBtn(RE_ACTIVAR);
      if (act) {
        log('pulso:', textoBtn(act));
        clicReal(act); yoActiveLosSubs = true;
        await sleep(500); escape();                       // cierra el panel
        return true;
      }
      if (buscarBtn(RE_DESACT)) {
        log('los subtítulos ya estaban activos');
        escape();
        return true;
      }
      if (!abierto) {
        const t = botonBarraCC();
        if (t) {
          log('abro el panel con:', textoBtn(t) || iconoDe(t));
          clicReal(t); abierto = true;
          await sleep(400);
          continue;
        }
      }
      await sleep(250);
    }

    if (abierto) { log('abrí el panel pero no vi "Activar subtítulos"'); escape(); return false; }

    log('no encontré ningún botón de subtítulos, pruebo con la tecla C');
    document.body.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'c', code: 'KeyC', keyCode: 67, bubbles: true }));
    yoActiveLosSubs = true;
    return false;
  }

  async function desactivarSubs() {
    if (!yoActiveLosSubs) return;
    yoActiveLosSubs = false;
    let abierto = false;
    for (let i = 0; i < 16; i++) {
      const d = buscarBtn(RE_DESACT);
      if (d) { clicReal(d); await sleep(300); escape(); return; }
      if (buscarBtn(RE_ACTIVAR)) { escape(); return; }     // ya estaban apagados
      if (!abierto) {
        const t = botonBarraCC();
        if (t) { clicReal(t); abierto = true; await sleep(400); continue; }
      }
      await sleep(250);
    }
  }

  // ---------- 2) Localizar el contenedor de subtítulos ----------

  function dentroDelEscenario(el) {
    let n = el.parentElement;
    for (let d = 0; d < 10 && n && n !== document.body; d++) {
      if (n.querySelector('video')) return true;
      n = n.parentElement;
    }
    return false;
  }

  function candidatoHeuristico() {
    const vh = innerHeight, vw = innerWidth;
    let min = null;
    for (const el of document.querySelectorAll('div,span,p')) {
      if (el.id === 'pop-subs-btn') continue;
      if (el.closest('[role="tooltip"]')) continue;
      if (el.closest('[aria-label*="hat" i]')) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 14 || r.width < 20) continue;
      if (r.top < vh * 0.55) continue;
      if (r.left > vw * 0.78) continue;
      if (el.querySelector('video,button')) continue;
      const t = norm(el.textContent);
      if (t.length < 4 || t.length > 400) continue;
      if (ICONO.test(t)) continue;
      if (!dentroDelEscenario(el)) continue;
      const area = r.width * r.height;
      if (!min || area < min.area) min = { el, area };
    }
    if (!min) return null;

    let n = min.el;
    for (let d = 0; d < 6; d++) {
      const p = n.parentElement;
      if (!p || p === document.body) break;
      if (p.querySelector('video')) break;
      const pr = p.getBoundingClientRect();
      if (pr.top < vh * 0.4 || pr.height > vh * 0.6) break;
      if (!norm(p.textContent)) break;
      n = p;
    }
    return n;
  }

  // Selectores conocidos de Meet, por orden de preferencia (el contenedor antes que el texto).
  // OJO: '.a4cQT' NO va aquí: coincide con la tarjeta "Agrega otras personas".
  const SELECTORES = ['div[jsname="tgaKEf"]', REGION];

  // Un candidato solo vale si está abajo, visible, sin vídeo y fuera de diálogos/popups.
  function valido(el) {
    if (!el || !el.isConnected) return false;
    if (el.id === 'pop-subs-btn') return false;
    if (el.closest('[role="dialog"],[role="tooltip"],[role="alertdialog"]')) return false;
    if (el.querySelector('video')) return false;
    const r = el.getBoundingClientRect();
    if (r.height < 10 || r.width < 20) return false;
    if (r.top < innerHeight * 0.45) return false;
    const t = norm(el.textContent);
    if (!t) return false;
    // Tarjeta de bienvenida / enlace de la reunión: nunca son subtítulos.
    if (/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}|Copiar v[ií]nculo|Copy (joining )?(link|info)|Agrega otras personas|Add others/i.test(t)) return false;
    return true;
  }

  function buscar() {
    for (const sel of SELECTORES) {
      for (const el of document.querySelectorAll(sel)) {
        if (valido(el)) { log('enganchado vía', sel); return el; }
      }
    }
    const h = candidatoHeuristico();
    return valido(h) ? h : null;
  }

  // ---------- 3) Quitar la franja negra ----------

  // Estructura real de Meet (comprobada en un volcado de su DOM):
  //   <main style="inset: 64px 16px 304px">       escenario (cámaras / presentación)
  //   <div data-side="3" data-priority="999">     panel inferior de subtítulos (.a4cQT, ~216 px)
  //   <div data-side="3" data-priority="1100">    barra de controles (~80 px)
  // Meet mide cada panel inferior y reserva ese hueco bajo el escenario (304 = 88 + 216).
  // Si el panel de subtítulos mide 0, Meet recupera el espacio solo, igual que con los subtítulos apagados.

  // El elemento que Meet dibuja en el centro del escenario (solo para el plan B).
  function centro() {
    return document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight * 0.35));
  }

  // Panel inferior que contiene los subtítulos (nunca el que contiene la barra de controles).
  function panelSubs(el) {
    const w = el.closest('[data-side="3"]');
    if (!w) return null;
    if (w.querySelector(
      'button[aria-label*="Salir de la llamada" i],button[aria-label*="Leave call" i],' +
      '[role="region"][aria-label*="ontroles" i],[role="region"][aria-label*="ontrols" i]')) return null;
    return w;
  }

  function collapse(el) {
    // El elemento de subtítulos sale de la vista pero SIGUE en el DOM, así que se sigue
    // actualizando y otra extensión puede seguir leyéndolo.
    touched.add(el); el.dataset.popSubs = 'leaf';

    let p = el.parentElement;
    const w = panelSubs(el);
    if (w) {
      // Todo lo que hay entre el texto y el panel se colapsa a 0 de alto: Meet mide 0 y libera el hueco.
      while (p && p !== document.body) {
        touched.add(p); p.dataset.popSubs = 'collapse';
        if (p === w) break;
        p = p.parentElement;
      }
    } else {
      // Plan B (si Meet cambia su estructura): colapsar hasta el ancestro común con el escenario.
      const c = centro();
      while (p && p !== document.body && !(c && p.contains(c))) {
        if (p.querySelector('button')) break;
        touched.add(p); p.dataset.popSubs = 'collapse';
        p = p.parentElement;
      }
    }

    reclamar();
    for (const ms of [300, 900, 2000]) setTimeout(reclamar, ms);
  }

  // Red de seguridad: si tras colapsar el panel el escenario sigue sin llegar a la barra,
  // se le fija el margen inferior correcto (válido también al presentar).
  let ultimoReclamo = 0;
  function reclamar() {
    if (!pip || !cap) return;
    ultimoReclamo = Date.now();
    const main = document.querySelector('main');
    if (!main) return;

    const w = cap.closest?.('[data-side="3"]');
    let topBarra = innerHeight, hay = false;
    for (const o of document.querySelectorAll('[data-side="3"]')) {
      if (o === w) continue;
      const r = o.getBoundingClientRect();
      if (r.height > 0) { hay = true; if (r.top < topBarra) topBarra = r.top; }
    }
    if (!hay) return;                                   // no reconozco la barra: no toco nada

    const hueco = topBarra - main.getBoundingClientRect().bottom;
    if (main.dataset.popSubs !== 'stage' && hueco <= 40) return;   // Meet ya lo hizo bien

    const bottom = Math.max(0, Math.round(innerHeight - topBarra + 8));
    const antes = parseInt(main.style.getPropertyValue('--ps-bottom'), 10);
    touched.add(main); main.dataset.popSubs = 'stage';
    main.style.setProperty('--ps-bottom', bottom + 'px');
    if (antes !== bottom) {
      log('escenario: margen inferior fijado a', bottom, 'px (hueco era', Math.round(hueco), 'px)');
      dispatchEvent(new Event('resize'));               // para que Meet recoloque las cámaras
    }
  }

  function restore() {
    const habia = touched.size > 0;
    for (const el of touched) {
      delete el.dataset.popSubs;
      el.style.removeProperty('--ps-bottom');
    }
    touched.clear();
    if (habia) dispatchEvent(new Event('resize'));
  }

  function bind(el) {
    if (!el || el === cap) return;
    restore();
    cap = el;
    vacioDesde = 0;
    collapse(cap);
    render();
  }

  // ---------- 4) Render en la ventana flotante ----------

  function render() {
    if (!out) return;
    const t = (cap?.innerText || '').replace(/ /g, ' ');
    if (!norm(t)) { if (!vacioDesde) vacioDesde = Date.now(); } else vacioDesde = 0;
    const lines = t.split('\n').map(norm)
      .filter(l => l && !ICONO_LINEA.test(l))
      .slice(-8);
    out.textContent = lines.length ? lines.join('\n') : 'Esperando subtítulos…';
    out.style.opacity = lines.length ? '1' : '.5';
  }

  function startObserver() {
    mo = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!cap || !document.contains(cap)) {
          const c = buscar();
          if (c) bind(c); else render();
          return;
        }
        if (cap.dataset.popSubs !== 'leaf') collapse(cap);
        else if (Date.now() - ultimoReclamo > 1200) reclamar();   // Meet re-maqueta a menudo
        render();
        if (vacioDesde && Date.now() - vacioDesde > 2000) {
          const c = buscar();
          if (c && c !== cap) { log('reenganche'); bind(c); }
        }
      });
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ---------- 5) Diagnóstico (Alt+clic sobre los subtítulos) ----------

  function dump(el) {
    const rows = [];
    let n = el;
    for (let d = 0; d < 9 && n && n !== document.body; d++) {
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      rows.push({
        tag: n.tagName, jsname: n.getAttribute('jsname'), role: n.getAttribute('role'),
        aria: n.getAttribute('aria-label'),
        cls: String(n.className || '').slice(0, 90),
        pos: cs.position, h: cs.height, pb: cs.paddingBottom,
        top: Math.round(r.top), height: Math.round(r.height),
        tieneVideo: !!n.querySelector('video'), tieneBoton: !!n.querySelector('button'),
      });
      n = n.parentElement;
    }
    const s = JSON.stringify(rows, null, 2);
    console.log(TAG, s);
    navigator.clipboard?.writeText(s).catch(() => {});
    return s;
  }

  // ---------- 6) Botón y apertura ----------

  function setButton(off) {
    const b = document.getElementById('pop-subs-btn');
    if (!b) return;
    b.textContent = off ? '⧉ Subtítulos' : '■ Cerrar subtítulos';
    b.style.background = off ? '#1a73e8' : '#d93025';
  }

  const CSS = `
    [data-pop-subs="leaf"]{
      position:fixed !important; left:-10000px !important; top:0 !important;
      width:100vw !important; height:auto !important; max-height:none !important;
      min-height:0 !important; margin:0 !important; padding:0 !important;
      border:0 !important; pointer-events:none !important;
    }
    [data-pop-subs="collapse"]{
      height:0 !important; min-height:0 !important; max-height:0 !important;
      padding:0 !important; margin:0 !important; border-width:0 !important;
      overflow:hidden !important; flex:0 0 0 !important; gap:0 !important;
    }
    main[data-pop-subs="stage"]{
      bottom:var(--ps-bottom) !important;
    }
  `;

  function limpiar() {
    mo?.disconnect(); mo = null;
    pip = null; out = null; cap = null; vacioDesde = 0;
    restore();
    document.getElementById('pop-subs-style')?.remove();
    setButton(true);
  }

  async function open() {
    if (pip) return;
    if (!('documentPictureInPicture' in window)) {
      alert('Este Chrome no soporta Document Picture-in-Picture (hace falta 116+).');
      return;
    }

    // El CSS va primero para que, al aparecer la franja, ya esté neutralizada.
    const style = document.createElement('style');
    style.id = 'pop-subs-style';
    style.textContent = CSS;
    document.head.append(style);

    // La ventana se pide YA, mientras el clic todavía cuenta como gesto del usuario.
    try {
      pip = await documentPictureInPicture.requestWindow({
        width: 560, height: 150, disallowReturnToOpener: true,
      });
    } catch (err) {
      log('no se pudo abrir la ventana', err);
      style.remove();
      return;
    }

    pip.document.documentElement.style.cssText = 'background:#000;margin:0';
    pip.document.body.style.cssText =
      'margin:0;padding:14px 16px;background:#000;color:#fff;height:100%;' +
      'box-sizing:border-box;overflow:hidden;font:600 20px/1.4 system-ui,sans-serif';

    // Caja del texto: anclada abajo, así siempre se ve lo último que se dijo.
    const caja = pip.document.createElement('div');
    caja.style.cssText =
      'height:100%;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;';

    out = pip.document.createElement('div');
    out.style.cssText = 'white-space:pre-wrap;transition:opacity .15s';
    out.textContent = 'Activando subtítulos…';
    out.style.opacity = '.5';
    caja.append(out);
    pip.document.body.append(caja);


    pip.addEventListener('pagehide', () => {
      limpiar();
      desactivarSubs();
      log('cerrado y restaurado');
    });

    startObserver();
    setButton(false);

    await activarSubs();

    // Esperar a que aparezca el contenedor (hasta ~5 s) y engancharlo.
    for (let i = 0; i < 20 && pip && !cap; i++) {
      const c = buscar();
      if (c) bind(c); else await sleep(250);
    }
    render();
  }

  function close() { pip?.close(); }

  const btn = document.createElement('button');
  btn.id = 'pop-subs-btn';
  btn.textContent = '⧉ Subtítulos';
  btn.style.cssText =
    'position:fixed;right:16px;bottom:120px;z-index:2147483647;padding:8px 12px;' +
    'border:0;border-radius:8px;background:#1a73e8;color:#fff;' +
    'font:600 13px system-ui;cursor:pointer;box-shadow:0 2px 8px #0006';
  btn.addEventListener('click', e => { e.stopPropagation(); pip ? close() : open(); });
  document.body.append(btn);

  // Alt+clic: forzar manualmente el elemento de subtítulos (y volcar diagnóstico)
  document.addEventListener('click', e => {
    if (!e.altKey || e.shiftKey || e.target === btn) return;
    e.preventDefault(); e.stopPropagation();
    dump(e.target);
    bind(e.target);
    if (!pip) open();
  }, true);

  addEventListener('keydown', e => {
    if (e.altKey && e.code === 'KeyC') { e.preventDefault(); pip ? close() : open(); }
    if (e.altKey && e.code === 'KeyD') {
      e.preventDefault();
      document.querySelectorAll('[data-pop-subs]').forEach(el => {
        el.style.outline = el.style.outline ? '' : '2px dashed magenta';
      });
    }
  });

  addEventListener('resize', () => { if (pip && cap) reclamar(); });

  log('listo v14');
})();
