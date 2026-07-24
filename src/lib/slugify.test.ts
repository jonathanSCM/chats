import { describe, it, expect } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugify("Demo Company")).toBe("demo-company");
  });

  it("strips accents and ñ", () => {
    expect(slugify("Café Ñoño S.A.")).toBe("cafe-nono-s-a");
  });

  it("collapses repeated separators and trims edge dashes", () => {
    expect(slugify("  --Hola   Mundo!!--  ")).toBe("hola-mundo");
  });

  it("returns an empty string for input with no alphanumeric characters", () => {
    expect(slugify("!!! ??? ---")).toBe("");
  });
});
