import { describe, expect, it } from "vitest";
import { loadMeetScripts, MEET_SCRIPTS, scriptVersion } from "./meet-scripts";

describe("scripts de Meet para copiar", () => {
  it("todos los archivos existen, son userscripts de Meet y tienen versión", async () => {
    const scripts = await loadMeetScripts();
    expect(scripts.map((s) => s.id)).toEqual(MEET_SCRIPTS.map((s) => s.id));
    for (const script of scripts) {
      expect(script.code, script.file).toContain("==UserScript==");
      expect(script.code, script.file).toContain("@match        https://meet.google.com/*");
      expect(script.version, script.file).toBeTruthy();
    }
  });

  it("lee la versión del encabezado", () => {
    expect(scriptVersion("// ==UserScript==\n// @version      1.4.1\n// ==/UserScript==")).toBe("1.4.1");
    expect(scriptVersion("sin encabezado")).toBeNull();
  });
});
