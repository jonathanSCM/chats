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
      manifest.action.default_popup,
      manifest.side_panel.default_path,
      ...Object.values<string>(manifest.icons),
      ...Object.values<string>(manifest.action.default_icon),
      ...manifest.content_scripts.flatMap((c: { js: string[] }) => c.js),
    ];
    for (const file of files) expect(exists(file), `falta ${file}`).toBe(true);
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
