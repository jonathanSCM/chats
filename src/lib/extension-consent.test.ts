import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La política de datos de usuario de la Chrome Web Store exige que la divulgación y el consentimiento estén DENTRO de la
 * interfaz de la extensión (no solo en la ficha de la tienda), antes de recopilar nada. Estas pruebas cuidan que el aviso siga
 * existiendo, que diga lo esencial y que el panel no muestre sesión, micrófono ni «Grabar» antes de aceptarlo.
 */
const dir = path.join(process.cwd(), "meet-captions-extension");
const html = readFileSync(path.join(dir, "sidepanel.html"), "utf8");
const js = readFileSync(path.join(dir, "sidepanel.js"), "utf8");

describe("aviso de consentimiento de la extensión", () => {
  it("dice qué se graba, a dónde va y quién es responsable de avisar a los participantes", () => {
    const consent = html.slice(html.indexOf('id="consentBox"'), html.indexOf('id="accountBox"'));
    expect(consent).toMatch(/subtítulos/i);
    expect(consent).toMatch(/micrófono/i);
    expect(consent).toMatch(/OpenAI/);
    expect(consent).toMatch(/debo avisar a los participantes/i);
    expect(consent).toContain("https://chats.proshop.lat/privacy");
    expect(consent).toMatch(/id="consentAccept"[^>]*disabled/); // no se puede aceptar sin marcar la casilla
  });

  it("el panel corta en el aviso antes de mostrar sesión, micrófono o el botón de grabar", () => {
    const render = js.slice(js.indexOf("async function render()"));
    expect(render.indexOf("if (!consent)")).toBeGreaterThan(-1);
    expect(render.indexOf("if (!consent)")).toBeLessThan(render.indexOf("renderAccount(auth)"));
    expect(render.indexOf("if (!consent)")).toBeLessThan(render.indexOf("showRecordBox("));
  });

  it("el aviso se vuelve a mostrar si cambia su versión", () => {
    expect(js).toMatch(/consent\.version >= CONSENT_VERSION/);
  });
});
