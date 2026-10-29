import { describe, expect, it } from "vitest";
import { chooseKey, classifyKeyError, isPlausibleOpenAiKey, lastFour, parseAiMode } from "./ai-key";

const none = { mode: "platform" as const, hasKey: false, alertMessage: null };
const own = { mode: "own" as const, hasKey: true, alertMessage: null };
const custom = { mode: "custom" as const, hasKey: true, alertMessage: null };

describe("chooseKey", () => {
  it("modo plataforma usa la clave de la plataforma", () => {
    expect(chooseKey(none, null)).toEqual({ source: "platform" });
  });

  it("modo propia o personalizada pero sin clave guardada todavía: sigue con la de la plataforma", () => {
    expect(chooseKey({ mode: "own", hasKey: false, alertMessage: null }, null)).toEqual({ source: "platform" });
    expect(chooseKey({ mode: "custom", hasKey: false, alertMessage: null }, null)).toEqual({ source: "platform" });
  });

  it("una clave guardada pero con el modo plataforma no se usa", () => {
    expect(chooseKey({ mode: "platform", hasKey: true, alertMessage: null }, null)).toEqual({ source: "platform" });
  });

  it("distingue la clave propia de la personalizada", () => {
    expect(chooseKey(own, null)).toEqual({ source: "own", holder: "self" });
    expect(chooseKey(custom, null)).toEqual({ source: "custom", holder: "self" });
  });

  it("una suborganización hereda la clave y el modo de su padre", () => {
    expect(chooseKey(none, own)).toEqual({ source: "own", holder: "parent" });
    expect(chooseKey(none, custom)).toEqual({ source: "custom", holder: "parent" });
  });

  it("la clave de la hija gana sobre la del padre", () => {
    expect(chooseKey(own, custom)).toEqual({ source: "own", holder: "self" });
  });

  it("si la clave falló, se bloquea y NO se cae a la de la plataforma ni a la del padre", () => {
    const failed = { ...own, alertMessage: "Sin saldo" };
    expect(chooseKey(failed, own)).toEqual({ source: "blocked", kind: "own", holder: "self", message: "Sin saldo" });
    expect(chooseKey(none, { ...custom, alertMessage: "Revocada" })).toEqual({
      source: "blocked",
      kind: "custom",
      holder: "parent",
      message: "Revocada",
    });
  });
});

describe("parseAiMode", () => {
  it("lee el modo y cae al de siempre si hay algo raro", () => {
    expect(parseAiMode("custom")).toBe("custom");
    expect(parseAiMode("own")).toBe("own");
    expect(parseAiMode("hackeado")).toBe("platform");
    expect(parseAiMode(undefined)).toBe("platform");
  });
});

describe("classifyKeyError", () => {
  it("sin saldo es definitivo", () => {
    expect(classifyKeyError({ status: 429, code: "insufficient_quota" })).toMatchObject({ definitive: true });
    expect(classifyKeyError({ status: 429, error: { type: "insufficient_quota" } }).message).toMatch(/saldo/i);
  });

  it("clave inválida o revocada es definitivo", () => {
    expect(classifyKeyError({ status: 401 }).definitive).toBe(true);
    expect(classifyKeyError({ code: "invalid_api_key" }).message).toMatch(/clave/i);
  });

  it("sin permiso para el modelo es definitivo", () => {
    expect(classifyKeyError({ status: 403 }).definitive).toBe(true);
  });

  it("un límite de velocidad o un error del servidor NO es definitivo (se reintenta, no se bloquea)", () => {
    expect(classifyKeyError({ status: 429, code: "rate_limit_exceeded" }).definitive).toBe(false);
    expect(classifyKeyError({ status: 500, message: "boom" }).definitive).toBe(false);
    expect(classifyKeyError(new Error("fetch failed")).definitive).toBe(false);
    expect(classifyKeyError(null).definitive).toBe(false);
  });
});

describe("clave", () => {
  it("reconoce el formato y guarda solo los últimos 4", () => {
    expect(isPlausibleOpenAiKey("sk-proj-abcdefghijklmnopqrstuvwxyz0123")).toBe(true);
    expect(isPlausibleOpenAiKey("hola")).toBe(false);
    expect(isPlausibleOpenAiKey("sk-corta")).toBe(false);
    expect(lastFour(" sk-proj-abcdefghijklmnopqrstuvwxyz0123 ")).toBe("0123");
  });
});
