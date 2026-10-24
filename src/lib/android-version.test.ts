import { describe, expect, it } from "vitest";
import { androidMajor, webApkUnsupported } from "./android-version";

describe("androidMajor", () => {
  it("lee la versión principal", () => {
    expect(androidMajor("8.1.0")).toBe(8);
    expect(androidMajor("13.0.0")).toBe(13);
    expect(androidMajor("9")).toBe(9);
  });
  it("devuelve null si no hay dato", () => {
    expect(androidMajor("")).toBeNull();
    expect(androidMajor(undefined)).toBeNull();
    expect(androidMajor("abc")).toBeNull();
  });
});

describe("webApkUnsupported", () => {
  it("Android 8.1 no puede abrir un WebAPK (caso del J7)", () => {
    expect(webApkUnsupported("Android", "8.1.0")).toBe(true);
    expect(webApkUnsupported("Android", "7.0.0")).toBe(true);
  });
  it("Android 9 o más sí", () => {
    expect(webApkUnsupported("Android", "9.0.0")).toBe(false);
    expect(webApkUnsupported("Android", "14.0.0")).toBe(false);
  });
  it("otras plataformas o datos desconocidos: no se bloquea", () => {
    expect(webApkUnsupported("Windows", "10.0.0")).toBe(false);
    expect(webApkUnsupported("Android", undefined)).toBe(false);
    expect(webApkUnsupported(undefined, "8.1.0")).toBe(false);
  });
});
