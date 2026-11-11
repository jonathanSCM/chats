import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardia de la extensión de Chrome (meet-captions-extension/): que el manifest apunte a archivos que existen y pida
 * justo los permisos que usa. Un archivo faltante o un permiso de más se descubren aquí y no al cargarla en Chrome o,
 * peor, en la revisión de la tienda.
 */
const dir = path.join(process.cwd(), "meet-captions-extension");
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
const exists = (file: string) => existsSync(path.join(dir, file));

describe("manifest de la extensión de Chrome", () => {
  it("todos los archivos que nombra existen", () => {
    const files: string[] = [
      manifest.background.service_worker,
      manifest.side_panel.default_path,
      ...Object.values<string>(manifest.icons),
      ...Object.values<string>(manifest.action.default_icon),
      ...manifest.web_accessible_resources.flatMap((r: { resources: string[] }) => r.resources),
      ...manifest.content_scripts.flatMap((c: { js: string[] }) => c.js),
    ];
    for (const file of files) expect(exists(file), `falta ${file}`).toBe(true);
  });

  it("el ícono abre directamente el panel (sin popup): ahí están la sesión, la organización y el botón de grabar", () => {
    expect(manifest.action.default_popup).toBeUndefined();
    expect(exists("popup.html")).toBe(false);
    expect(manifest.side_panel.default_path).toBe("sidepanel.html");
    expect(readFileSync(path.join(dir, "background.js"), "utf8")).toContain("openPanelOnActionClick: true");
  });

  it("el script de la pestaña de Meet no deja llamadas chrome.* sueltas: con la extensión recargada fallarían con «Extension context invalidated»", () => {
    const content = readFileSync(path.join(dir, "content.js"), "utf8");
    expect(content.match(/chrome\.runtime\.sendMessage\(/g)).toHaveLength(1); // solo dentro de send()
    expect(content.match(/chrome\.storage\.local\.get\(/g)).toHaveLength(2); // store() y el aviso al cerrar la pestaña
    expect(content).toContain("Extension context invalidated");
  });

  it("captions-dom.js se carga antes que content.js (content.js lo usa)", () => {
    const meet = manifest.content_scripts.find((c: { matches: string[] }) => c.matches.some((m) => m.includes("meet.google.com")));
    expect(meet.js).toEqual(["captions-dom.js", "content.js"]);
  });

  it("pide exactamente los permisos que usa, y ningún permiso amplio", () => {
    expect([...manifest.permissions].sort()).toEqual(["activeTab", "offscreen", "sidePanel", "storage", "tabCapture"]);
    expect(manifest.host_permissions).toEqual(["https://meet.google.com/*", "https://chats.proshop.lat/*"]);
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(116); // sidePanel.open
  });

  it("tiene versión 2.x, nombre y una descripción corta apta para la tienda (≤ 132)", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toMatch(/^2\./);
    expect(manifest.name.length).toBeLessThanOrEqual(75);
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });
});
