import { describe, expect, it } from "vitest";
import { LEGACY_BROWSER_NOTICE_SCRIPT } from "./legacy-browser-notice";

describe("LEGACY_BROWSER_NOTICE_SCRIPT", () => {
  it("es JavaScript válido", () => {
    expect(() => new Function(LEGACY_BROWSER_NOTICE_SCRIPT)).not.toThrow();
  });

  it("está escrito en ES5 (sin flechas, const/let ni plantillas) para que lo entienda un navegador viejo", () => {
    expect(LEGACY_BROWSER_NOTICE_SCRIPT).not.toMatch(/=>|\bconst\b|\blet\b|`/);
  });

  it("no hace nada y no falla en un navegador moderno sin DOM de prueba", () => {
    const fake = {
      window: { CSS: { supports: () => true } },
      document: { getElementById: () => null, createElement: () => ({}), addEventListener: () => {}, body: null },
      CSS: { supports: () => true },
    };
    const run = new Function("window", "document", "CSS", LEGACY_BROWSER_NOTICE_SCRIPT);
    expect(() => run(fake.window, fake.document, fake.CSS)).not.toThrow();
  });
});
