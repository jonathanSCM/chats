import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Corre el content.js REAL de la extensión dentro de un navegador de mentira (Meet falso + chrome.* falso) para comprobar el
 * guardado por partes: cada ~30 s se manda solo lo nuevo, un fallo no pierde líneas, el cierre manda lo que falte y queda una
 * copia local que se borra al enviarse bien (y que el panel usa para recuperar una grabación que se cortó).
 */
const code = readFileSync(path.join(process.cwd(), "meet-captions-extension", "content.js"), "utf8");

type Block = { name: string; text: string };

function setup() {
  const store: Record<string, unknown> = { token: "tok", consent: { version: 1, at: 1 }, hideMeetCaptions: false, captionLang: "none" };
  const blocks: Block[] = [];
  const handlers: Record<string, () => void> = {};
  let onMessage: (m: unknown, s: unknown, r: (x: unknown) => void) => boolean | void = () => false;
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
  const beacons: { url: string; blob: Blob }[] = [];

  const fakeEl = () => ({ style: {}, isConnected: true, id: "", textContent: "", append() {}, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {}, querySelector: () => null });
  const buttonPersonas = { getAttribute: () => "Personas", textContent: "3" };
  const region = {
    querySelectorAll: (sel: string) =>
      sel === ".nMcdL"
        ? blocks.map((b) => ({ querySelector: (q: string) => (q === ".NWpY1d" ? { textContent: b.name } : q === ".ygicle" ? { textContent: b.text } : null) }))
        : [],
    innerText: "",
  };
  const document = {
    documentElement: {},
    body: { appendChild() {} },
    activeElement: null,
    createElement: fakeEl,
    addEventListener() {},
    querySelector: (sel: string) => (sel.includes('role="region"') && blocks.length > 0 ? region : null),
    querySelectorAll: (sel: string) => (sel.includes("button") ? [buttonPersonas] : []),
  };
  const captions = { activate: async () => true, desactivar: async () => false, setHidden() {}, isHidden: () => false, describe: () => "{}", hueco: () => "{}", estructura: () => "{}" };
  const win: Record<string, unknown> = {
    location: { pathname: "/abc-defg-hij" },
    addEventListener: (type: string, fn: () => void) => (handlers[type] = fn),
    dispatchEvent() {},
    innerHeight: 900,
    innerWidth: 1600,
    ProShopCaptions: captions,
  };
  const read = (keys: unknown) => {
    const list = keys === null ? Object.keys(store) : Array.isArray(keys) ? (keys as string[]) : [String(keys)];
    return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
  };
  const chrome = {
    runtime: { id: "ext", sendMessage: async () => undefined, getURL: (p: string) => p, onMessage: { addListener: (fn: typeof onMessage) => (onMessage = fn) } },
    storage: {
      local: {
        get: (keys: unknown, cb?: (r: unknown) => void) => {
          const r = read(keys);
          if (cb) cb(r);
          return Promise.resolve(r);
        },
        set: async (o: Record<string, unknown>) => void Object.assign(store, o),
        remove: async (k: string | string[]) => void [k].flat().forEach((key) => delete store[key]),
      },
    },
  };
  const ctx = {
    window: win,
    self: win,
    document,
    chrome,
    fetch: fetchMock,
    navigator: { sendBeacon: (url: string, blob: Blob) => (beacons.push({ url, blob }), true) },
    crypto: globalThis.crypto,
    Blob,
    Date,
    console,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(ctx);
  new vm.Script(code).runInContext(ctx);

  const message = (m: unknown) => new Promise<unknown>((resolve) => void (onMessage(m, {}, resolve) === true ? null : resolve(undefined)));
  const posts = () => fetchMock.mock.calls.map((c) => JSON.parse(((c as unknown[])[1] as { body: string }).body) as { transcript: string; final: boolean; recordingId: string });
  return { store, blocks, handlers, fetchMock, beacons, message, posts };
}

const L1 = { name: "Ana", text: "Hola, gracias por conectarte a la llamada de hoy" };
const L2 = { name: "Luis", text: "Buenas, vamos a revisar la propuesta comercial" };
const L3 = { name: "Ana", text: "Perfecto, empecemos con los precios del plan" };
const L4 = { name: "Luis", text: "Me parece bien, lo comparto con mi equipo" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function startRecording(t: ReturnType<typeof setup>) {
  const started = t.message({ type: "START_RECORDING", organizationId: null, title: "Demo", recordingId: "rec-1" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(await started).toEqual({ ok: true });
}

describe("guardado por partes de los subtítulos", () => {
  it("cada ~30 s manda solo las líneas nuevas (sin cierre) y deja una copia local", async () => {
    const t = setup();
    await startRecording(t);
    t.blocks.push(L1, L2, L3); // L3 sigue «en curso»: aún no se guarda
    await vi.advanceTimersByTimeAsync(31_000);
    expect(t.posts()).toHaveLength(1);
    expect(t.posts()[0]).toMatchObject({ final: false, recordingId: "rec-1", transcript: `${L1.name}: ${L1.text}\n${L2.name}: ${L2.text}` });
    const local = t.store["rec:rec-1"] as { lines: string[]; sentCount: number; closed: boolean };
    expect(local.sentCount).toBe(2);
    expect(local.closed).toBe(false);

    t.blocks.push(L4);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(t.posts()).toHaveLength(2);
    expect(t.posts()[1].transcript).toBe(`${L3.name}: ${L3.text}`); // solo lo nuevo, no se repite lo anterior
  });

  it("si un envío falla no se pierde nada: el siguiente lleva también lo que no llegó", async () => {
    const t = setup();
    await startRecording(t);
    t.fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    t.blocks.push(L1, L2, L3);
    await vi.advanceTimersByTimeAsync(31_000);
    expect((t.store["rec:rec-1"] as { sentCount: number }).sentCount).toBe(0);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(t.posts()[1].transcript).toBe(`${L1.name}: ${L1.text}\n${L2.name}: ${L2.text}`);
    expect((t.store["rec:rec-1"] as { sentCount: number }).sentCount).toBe(2);
  });

  it("al detener manda lo que falta con cierre (final) y borra la copia local", async () => {
    const t = setup();
    await startRecording(t);
    t.blocks.push(L1, L2, L3);
    await vi.advanceTimersByTimeAsync(31_000); // L1 y L2 ya enviadas
    await t.message({ type: "STOP_AND_SEND" });
    const last = t.posts().at(-1)!;
    expect(last.final).toBe(true);
    expect(last.transcript).toBe(`${L3.name}: ${L3.text}`); // lo último que se estaba diciendo
    expect(t.store["rec:rec-1"]).toBeUndefined();
  });

  it("si el cierre falla (sin red) la copia local queda marcada como cerrada para recuperarla desde el panel", async () => {
    const t = setup();
    await startRecording(t);
    t.blocks.push(L1, L2, L3);
    await vi.advanceTimersByTimeAsync(5_000);
    t.fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    await t.message({ type: "STOP_AND_SEND" });
    const local = t.store["rec:rec-1"] as { closed: boolean; lines: string[]; sentCount: number };
    expect(local.closed).toBe(true);
    expect(local.lines).toHaveLength(3);
    expect(local.sentCount).toBe(0);
  });

  it("una prueba muy corta no crea nada en el CRM", async () => {
    const t = setup();
    await startRecording(t);
    t.blocks.push({ name: "Ana", text: "hola" });
    await vi.advanceTimersByTimeAsync(31_000);
    await t.message({ type: "STOP_AND_SEND" });
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it("al cerrar la pestaña sin detener, el sendBeacon manda lo que falta con cierre", async () => {
    const t = setup();
    await startRecording(t);
    t.blocks.push(L1, L2, L3);
    await vi.advanceTimersByTimeAsync(31_000);
    t.handlers.pagehide();
    expect(t.beacons).toHaveLength(1);
    const body = JSON.parse(await t.beacons[0].blob.text());
    expect(body).toMatchObject({ final: true, token: "tok", recordingId: "rec-1", transcript: `${L3.name}: ${L3.text}` });
  });
});
