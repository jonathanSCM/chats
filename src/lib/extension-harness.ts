import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { vi } from "vitest";

/**
 * Banco de pruebas de la extensión: corre los scripts REALES (content.js, captions-dom.js) dentro de una página de mentira
 * (jsdom) con chrome.*, fetch y sendBeacon falsos. Sirve para comprobar cómo lee los subtítulos con distintas versiones del HTML
 * de Meet, el guardado por partes, la recuperación y el ajuste de las cámaras, sin abrir Chrome ni una reunión.
 *
 * Los temporizadores son los de vitest (vi.useFakeTimers() ANTES de llamar a createMeet): se avanza el tiempo con
 * vi.advanceTimersByTimeAsync.
 */
const dir = path.join(process.cwd(), "meet-captions-extension");
const read = (f: string) => readFileSync(path.join(dir, f), "utf8");

export interface Block {
  name: string;
  text: string;
}

/** Subtítulos como los pinta Meet hoy: región «Subtítulos» con bloques .nMcdL (avatar, nombre .NWpY1d, texto .ygicle). */
export function captionsByClass(blocks: Block[], label = "Subtítulos"): string {
  if (blocks.length === 0) return "";
  return (
    `<div role="region" aria-label="${label}" tabindex="0"><div>` +
    blocks
      .map((b) => `<div class="nMcdL"><img src="https://lh3.googleusercontent.com/a/x" alt=""><div class="adE6rb"><span class="NWpY1d">${b.name}</span></div><div class="ygicle VbkSUe">${b.text}</div></div>`)
      .join("") +
    `</div></div>`
  );
}

/** Lo mismo pero con los nombres de clase CAMBIADOS (Meet los renombra con cada versión): solo queda la estructura. */
export function captionsRenamed(blocks: Block[], label = "Subtítulos"): string {
  if (blocks.length === 0) return "";
  return (
    `<div role="region" aria-label="${label}" tabindex="0"><div class="zQ1">` +
    blocks
      .map((b) => `<div class="k9d"><img src="https://lh3.googleusercontent.com/a/x" alt=""><div class="q3"><span class="r7">${b.name}</span></div><div class="t5"><span>${b.text}</span></div></div>`)
      .join("") +
    `</div></div>`
  );
}

export interface MeetOptions {
  /** HTML de la región de subtítulos (captionsByClass / captionsRenamed). */
  captions?: string;
  /** HTML extra dentro del body (botones de la barra, paneles, escenario…). */
  body?: string;
  url?: string;
  /** Cargar el captions-dom.js real (si no, se usa uno de mentira: solo para probar content.js). */
  realCaptions?: boolean;
  store?: Record<string, unknown>;
}

const PERSONAS = '<button aria-label="Personas"><span>3</span></button>';

export function createMeet(options: MeetOptions = {}) {
  const store: Record<string, unknown> = { token: "tok", consent: { version: 1, at: 1 }, hideMeetCaptions: false, captionLang: "none", ...options.store };
  const dom = new JSDOM(`<!doctype html><html><body><main></main><div id="captions-slot">${options.captions ?? ""}</div>${PERSONAS}${options.body ?? ""}</body></html>`, {
    url: options.url ?? "https://meet.google.com/abc-defg-hij",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Record<string, unknown> & Window & { eval(code: string): unknown; Event: typeof Event };
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response);
  const beacons: { url: string; blob: Blob }[] = [];
  const messages: { type: string; [k: string]: unknown }[] = []; // lo que la página le manda al service worker
  let onMessage: (m: unknown, s: unknown, r: (x: unknown) => void) => boolean | void = () => false;
  const readStore = (keys: unknown) => {
    const list = keys === null ? Object.keys(store) : Array.isArray(keys) ? (keys as string[]) : [String(keys)];
    return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
  };
  win.chrome = {
    runtime: { id: "ext", sendMessage: async (m: { type: string }) => (messages.push(m), undefined), getURL: (p: string) => p, onMessage: { addListener: (fn: typeof onMessage) => (onMessage = fn) } },
    storage: {
      local: {
        get: (keys: unknown, cb?: (r: unknown) => void) => {
          const r = readStore(keys);
          if (cb) cb(r);
          return Promise.resolve(r);
        },
        set: async (o: Record<string, unknown>) => void Object.assign(store, o),
        remove: async (k: string | string[]) => void [k].flat().forEach((key) => delete store[key]),
      },
    },
  };
  // Temporizadores, fecha, red y utilidades: los de la prueba (con el reloj de mentira de vitest).
  let closed = false;
  const raf = (cb: (t: number) => void) => (closed ? 0 : (setTimeout(() => !closed && cb(Date.now()), 16) as unknown as number));
  for (const [k, v] of Object.entries({ setInterval, clearInterval, setTimeout, clearTimeout, Date, fetch: fetchMock, Blob, requestAnimationFrame: raf, cancelAnimationFrame: clearTimeout })) {
    Object.defineProperty(win, k, { value: v, configurable: true, writable: true });
  }
  Object.defineProperty(win, "crypto", { value: globalThis.crypto, configurable: true });
  Object.defineProperty(win.navigator, "sendBeacon", { value: (url: string, blob: Blob) => (beacons.push({ url, blob }), true), configurable: true });

  if (options.realCaptions) {
    win.eval(read("captions-dom.js"));
  } else {
    win.ProShopCaptions = { activate: async () => true, desactivar: async () => false, setHidden() {}, isHidden: () => false, describe: () => "{}", hueco: () => "{}", estructura: () => "{}" };
  }
  win.eval(read("content.js"));

  const message = (m: unknown) => new Promise<unknown>((resolve) => void (onMessage(m, {}, resolve) === true ? null : resolve(undefined)));
  const posts = () => fetchMock.mock.calls.map((c) => JSON.parse(((c as unknown[])[1] as { body: string }).body) as { transcript: string; final: boolean; recordingId: string });
  const setCaptions = (html: string) => {
    win.document.getElementById("captions-slot")!.innerHTML = html;
  };
  const pagehide = () => win.dispatchEvent(new win.Event("pagehide"));
  const close = () => {
    closed = true;
    vi.clearAllTimers(); // los intervalos de content.js: que no sigan corriendo con la página ya cerrada
    dom.window.close();
  };
  return { dom, win, document: win.document, store, fetchMock, beacons, messages, message, posts, setCaptions, pagehide, close };
}

export type Meet = ReturnType<typeof createMeet>;
