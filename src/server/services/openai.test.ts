import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./openai";

describe("buildSystemPrompt", () => {
  it("includes the company name", () => {
    const prompt = buildSystemPrompt({ companyName: "Demo Company" }, []);
    expect(prompt).toContain("Demo Company");
  });

  it("falls back to a generic name when companyName is missing", () => {
    const prompt = buildSystemPrompt({}, []);
    expect(prompt).toContain("la empresa");
  });

  it("includes personality and instructions only when present", () => {
    const withBoth = buildSystemPrompt(
      { personality: "Cercano y directo", instructions: "Cierra la venta rápido" },
      [],
    );
    expect(withBoth).toContain("Cercano y directo");
    expect(withBoth).toContain("Cierra la venta rápido");

    const withNeither = buildSystemPrompt({}, []);
    expect(withNeither).not.toContain("Carácter y tono");
    expect(withNeither).not.toContain("Instrucciones específicas");
  });

  it("omits the catalog section when there are no items", () => {
    const prompt = buildSystemPrompt({}, []);
    expect(prompt).not.toContain("Catálogo disponible");
  });

  it("lists catalog items with price and description", () => {
    const prompt = buildSystemPrompt({}, [
      { name: "Mesa de roble", price: { toString: () => "189.00" }, description: "De madera maciza" },
      { name: "Silla nórdica", price: null, description: null },
    ]);
    expect(prompt).toContain("- Mesa de roble — $189.00: De madera maciza");
    expect(prompt).toContain("- Silla nórdica");
  });
});
