import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Chrome solo le da `chrome.runtime` a una página "offscreen": NO tiene chrome.storage. La versión anterior leía el token
 * del CRM desde ahí y la subida del audio fallaba siempre con «chrome.storage.local no está disponible». La sesión se le
 * pasa desde background.js en el mensaje de inicio; este test impide que vuelva a leer el almacenamiento.
 */
const dir = path.join(process.cwd(), "meet-captions-extension");
const code = (file: string) => readFileSync(path.join(dir, file), "utf8");

describe("grabador de audio (offscreen.js)", () => {
  it("no usa chrome.storage (no existe en una página offscreen)", () => {
    const withoutComments = code("offscreen.js").replace(/\/\/.*$/gm, "");
    expect(withoutComments).not.toMatch(/chrome\.storage/);
  });

  it("recibe la sesión del CRM en el mensaje de inicio que arma background.js", () => {
    expect(code("background.js")).toMatch(/OFFSCREEN_START[\s\S]{0,400}token:/);
    expect(code("offscreen.js")).toMatch(/startRecording\(\{[^}]*token[^}]*apiBase/);
  });
});
