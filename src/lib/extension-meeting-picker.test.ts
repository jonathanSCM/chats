import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

/** El selector «Reunión del CRM» del panel, con el sidepanel.js REAL sobre el sidepanel.html real y un CRM de mentira. */
const dir = path.join(process.cwd(), "meet-captions-extension");
const read = (f: string) => readFileSync(path.join(dir, f), "utf8");

const MEETINGS = [
  { id: "m1", title: "Demo con Ana", client: "Ana Pérez", scheduledAt: new Date().toISOString(), status: "SCHEDULED", meetingUrl: "https://meet.google.com/abc-defg-hij", hasTranscript: false },
  { id: "m2", title: "Seguimiento", client: null, scheduledAt: new Date(Date.now() + 86400000).toISOString(), status: "CONFIRMED", meetingUrl: null, hasTranscript: true },
];

async function boot() {
  const dom = new JSDOM(read("sidepanel.html"), { url: "chrome-extension://x/sidepanel.html?tab=1", runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window as unknown as Record<string, any> & Window;
  const store: Record<string, unknown> = { token: "tok", consent: { version: 1, at: 1 }, orgId: "org1", apiBase: "https://crm.test" };
  const noop = () => {};
  const ev = { addListener: noop };
  const fetchMock = vi.fn(async (url: URL | string) => {
    const u = String(url);
    if (u.includes("/meetings/list")) return { ok: true, status: 200, json: async () => ({ meetings: MEETINGS, hasMore: false }) } as unknown as Response;
    return { ok: true, status: 200, json: async () => ({ organizations: [{ id: "org1", name: "Org" }], activeOrganizationId: "org1" }) } as unknown as Response;
  });
  win.chrome = {
    runtime: { getManifest: () => ({ version: "9.9.9" }), sendMessage: async () => undefined, onMessage: ev, getURL: (p: string) => p },
    storage: {
      local: { get: async (k: unknown) => Object.fromEntries((Array.isArray(k) ? k : [String(k)]).filter((x) => x in store).map((x) => [x, store[x]])), set: async (o: object) => void Object.assign(store, o), remove: async () => {} },
      session: { get: async () => ({}) },
      onChanged: ev,
    },
    tabs: { get: async () => ({ id: 1, url: "https://meet.google.com/abc-defg-hij" }), query: async () => [], sendMessage: async () => ({ ok: true }), onActivated: ev, onUpdated: ev, reload: async () => {} },
    permissions: { request: async () => true },
  };
  Object.defineProperty(win, "fetch", { value: fetchMock, configurable: true });
  Object.defineProperty(win, "crypto", { value: globalThis.crypto, configurable: true });
  Object.defineProperty(win.navigator, "mediaDevices", { value: { addEventListener: noop, enumerateDevices: async () => [], getUserMedia: async () => { throw new Error("sin micrófono"); } }, configurable: true });
  Object.defineProperty(win.navigator, "permissions", { value: { query: async () => ({ state: "prompt", addEventListener: noop }) }, configurable: true });
  Object.defineProperty(win, "AbortSignal", { value: AbortSignal, configurable: true });
  win.eval(read("sidepanel.js"));
  await new Promise((r) => setTimeout(r, 50));
  return { win, doc: win.document, fetchMock, close: () => dom.window.close() };
}

describe("selector de reunión del CRM en el panel", () => {
  it("lista las reuniones agrupadas por día, marca la de esta sala y permite elegir una", async () => {
    const { doc, fetchMock, close } = await boot();
    (doc.getElementById("meetPickBtn") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(doc.body.classList.contains("meet-open")).toBe(true);
    expect(String(fetchMock.mock.calls.find((c) => String(c[0]).includes("/meetings/list"))?.[0])).toContain("scope=upcoming");
    const cards = doc.querySelectorAll(".mv-card");
    expect(cards).toHaveLength(2);
    expect(doc.querySelectorAll(".mv-day").length).toBeGreaterThanOrEqual(2);
    expect(cards[0].textContent).toContain("Esta sala de Meet");
    expect(cards[1].textContent).toContain("Ya tiene grabaciones");

    (cards[0] as HTMLButtonElement).click();
    expect(doc.body.classList.contains("meet-open")).toBe(false);
    expect(doc.getElementById("meetPickLabel")!.textContent).toBe("Demo con Ana · Ana Pérez");
    expect((doc.getElementById("titleField") as HTMLElement).style.display).toBe("none"); // el nombre sale del CRM
    close();
  });

  it("«Todas» pide todas las reuniones y la búsqueda manda el texto", async () => {
    const { doc, fetchMock, close } = await boot();
    (doc.getElementById("meetPickBtn") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    (doc.getElementById("mvAll") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("scope=all"))).toBe(true);
    const input = doc.getElementById("mvSearch") as HTMLInputElement;
    input.value = "demo";
    input.dispatchEvent(new (doc.defaultView as any).Event("input"));
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("q=demo"))).toBe(true);
    close();
  });

  it("«Detectar sola» quita la elección", async () => {
    const { doc, close } = await boot();
    (doc.getElementById("meetPickBtn") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 50));
    (doc.querySelector(".mv-card") as HTMLButtonElement).click();
    (doc.getElementById("meetPickBtn") as HTMLButtonElement).click();
    (doc.getElementById("mvClear") as HTMLButtonElement).click();
    expect(doc.getElementById("meetPickLabel")!.textContent).toBe("Detectar sola (recomendado)");
    expect((doc.getElementById("titleField") as HTMLElement).style.display).toBe("grid");
    await new Promise((r) => setTimeout(r, 60)); // deja terminar la carga pendiente antes de cerrar la página de mentira
    close();
  });
});
