import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Que la extensión no se trabe mientras se graba: ninguna llamada de red puede quedar colgada, el panel no se redibuja a
 * cada cambio, la página de Meet no trabaja de más y una grabación vieja de audio no bloquea la nueva.
 */
const dir = path.join(process.cwd(), "meet-captions-extension");
const code = (file: string) => readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");

describe("la extensión no se queda colgada", () => {
  it("todo fetch tiene tiempo máximo (subtítulos, audio, organizaciones)", () => {
    expect(code("content.js")).toMatch(/fetch\(base \+ API_PATH,[\s\S]{0,120}AbortSignal\.timeout/);
    expect(code("offscreen.js")).toMatch(/fetch\(base \+ "\/api\/extension\/audio",[\s\S]{0,120}AbortSignal\.timeout/);
    expect(code("sidepanel.js")).toMatch(/\/api\/extension\/me`,[\s\S]{0,120}AbortSignal\.timeout/);
  });

  it("«Detener y enviar» no se queda pegado si la página no contesta", () => {
    expect(code("sidepanel.js")).toMatch(/Promise\.race\(\[chrome\.tabs\.sendMessage\(tabId, \{ type: "STOP_AND_SEND" \}\)/);
  });

  it("el panel dibuja de a una vez por ráfaga de cambios y el diagnóstico va con retraso", () => {
    const js = code("sidepanel.js");
    expect(js).toMatch(/function render\(\) \{\s*if \(renderRunning\)/);
    expect(js).toMatch(/async function renderNow\(\)/);
    expect(js).toMatch(/scheduleDebug\(\);/);
  });

  it("el estado en vivo solo se manda cuando cambia (o cada 10 s)", () => {
    expect(code("content.js")).toMatch(/json === lastLiveJson && Date\.now\(\) - lastLiveAt < 10000/);
  });

  it("el vigilante de la franja de Meet no reacciona a cada cambio de pantalla", () => {
    expect(code("captions-dom.js")).toMatch(/400 - \(Date\.now\(\) - lastObserverRun\)/);
  });

  it("una grabación de audio vieja no bloquea la nueva; cerrar la pestaña suelta la captura", () => {
    expect(code("offscreen.js")).not.toMatch(/throw new Error\("Ya hay una grabación de audio en otra pestaña/);
    expect(code("offscreen.js")).toMatch(/message\.tabId == null \|\| \(session && session\.tabId === message\.tabId\)/);
    expect(code("background.js")).toMatch(/tabs\.onRemoved[\s\S]{0,500}OFFSCREEN_STOP", tabId/);
  });

  it("la copia «lite» usa el mismo captions-dom.js", () => {
    const lite = readFileSync(path.join(process.cwd(), "meet-captions-extension-lite", "captions-dom.js"), "utf8").replace(/\r\n/g, "\n");
    expect(lite).toBe(code("captions-dom.js"));
  });
});
