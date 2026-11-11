import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Cuida las protecciones de fiabilidad de la extensión (captura de audio y recuperación de grabaciones cortadas). */
const dir = path.join(process.cwd(), "meet-captions-extension");
const bg = readFileSync(path.join(dir, "background.js"), "utf8");
const panel = readFileSync(path.join(dir, "sidepanel.js"), "utf8");
const html = readFileSync(path.join(dir, "sidepanel.html"), "utf8");

describe("captura de audio", () => {
  it("el grabador se crea y los ajustes se leen ANTES de pedir el id de captura (el id vence a los pocos segundos)", () => {
    const start = bg.slice(bg.indexOf('case "START_AUDIO_CAPTURE"'));
    const offscreen = start.indexOf("await ensureOffscreenDocument()");
    const settings = start.indexOf('chrome.storage.local.get(["token"');
    const mint = start.indexOf("await tabStreamId(");
    const send = start.indexOf('type: "OFFSCREEN_START"');
    expect(offscreen).toBeGreaterThan(-1);
    expect(offscreen).toBeLessThan(mint);
    expect(settings).toBeLessThan(mint);
    expect(mint).toBeLessThan(send);
  });

  it("antes de pedir el id mira si la pestaña ya tiene una captura (getCapturedTabs) y la suelta", () => {
    expect(bg).toContain("chrome.tabCapture.getCapturedTabs()");
    expect(bg.indexOf("tabIsCaptured(tabId)")).toBeLessThan(bg.indexOf("chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })"));
    expect(bg).toMatch(/active stream/);
  });
});

describe("recuperación de grabaciones sin cerrar", () => {
  it("el panel tiene el aviso con enviar y descartar", () => {
    for (const id of ["recoverBox", "recoverText", "recoverSend", "recoverDiscard", "recoverStatus"]) expect(html).toContain(`id="${id}"`);
  });

  it("usa las copias locales «rec:<id>», no ofrece la grabación que está en curso y limpia las muy viejas", () => {
    expect(panel).toContain('key.startsWith("rec:")');
    expect(panel).toMatch(/lastState\.recordingId === rec\.recordingId/);
    expect(panel).toContain("RECOVER_MAX_AGE_MS");
  });

  it("manda solo lo que no llegó (desde sentCount) y con cierre", () => {
    const send = panel.slice(panel.indexOf("async function recoverSend"));
    expect(send).toMatch(/slice\(rec\.sentCount \|\| 0\)/);
    expect(send).toContain("final: true");
  });
});
