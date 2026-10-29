import { describe, expect, it } from "vitest";
import { chooseKey, classifyKeyError, isPlausibleOpenAiKey, lastFour } from "./ai-key";

const none = { aiOwnKeyEnabled: false, hasKey: false, alertMessage: null };
const own = { aiOwnKeyEnabled: true, hasKey: true, alertMessage: null };

describe("chooseKey", () => {
  it("sin opción propia usa la clave de la plataforma", () => {
    expect(chooseKey(none, null)).toEqual({ source: "platform" });
  });

  it("opción habilitada pero sin clave guardada todavía: sigue con la de la plataforma", () => {
    expect(chooseKey({ aiOwnKeyEnabled: true, hasKey: false, alertMessage: null }, null)).toEqual({ source: "platform" });
  });

  it("una clave guardada pero con la opción apagada por el superadmin no se usa", () => {
    expect(chooseKey({ aiOwnKeyEnabled: false, hasKey: true, alertMessage: null }, null)).toEqual({ source: "platform" });
  });

  it("con clave propia usa la propia", () => {
    expect(chooseKey(own, null)).toEqual({ source: "own", holder: "self" });
  });

  it("una suborganización hereda la clave de su padre", () => {
    expect(chooseKey(none, own)).toEqual({ source: "own", holder: "parent" });
  });

  it("la clave propia de la hija gana sobre la del padre", () => {
    expect(chooseKey(own, own)).toEqual({ source: "own", holder: "self" });
  });

  it("si la clave propia falló, se bloquea y NO se cae a la de la plataforma ni a la del padre", () => {
    const failed = { ...own, alertMessage: "Sin saldo" };
    expect(chooseKey(failed, own)).toEqual({ source: "blocked", holder: "self", message: "Sin saldo" });
    expect(chooseKey(none, failed)).toEqual({ source: "blocked", holder: "parent", message: "Sin saldo" });
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
