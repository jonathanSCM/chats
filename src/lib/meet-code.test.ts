import { describe, expect, it } from "vitest";
import { extractMeetCode } from "./meet-code";

describe("extractMeetCode", () => {
  it("link normal", () => {
    expect(extractMeetCode("https://meet.google.com/pev-nvwv-wir")).toBe("pev-nvwv-wir");
  });

  it("link con /meet/ (el que fallaba y devolvía \"meet\")", () => {
    expect(extractMeetCode("https://meet.google.com/meet/mnv-oyno-crx")).toBe("mnv-oyno-crx");
    expect(extractMeetCode("https://meet.google.com/meet/sad-ebpm-xbp")).toBe("sad-ebpm-xbp");
  });

  it("ignora parámetros y mayúsculas", () => {
    expect(extractMeetCode("https://meet.google.com/ABC-defg-hij?authuser=0&hs=122")).toBe("abc-defg-hij");
  });

  it("link /lookup/ con código estándar", () => {
    expect(extractMeetCode("https://meet.google.com/lookup/abc-defg-hij")).toBe("abc-defg-hij");
  });

  it("código con apodo, sin confundirlo con palabras reservadas", () => {
    expect(extractMeetCode("https://meet.google.com/meet/mi-sala-equipo")).toBe("mi-sala-equipo");
  });

  it("no es un link de Meet o no trae código", () => {
    expect(extractMeetCode("https://zoom.us/j/123456")).toBeNull();
    expect(extractMeetCode("https://meet.google.com/")).toBeNull();
    expect(extractMeetCode("https://meet.google.com/meet/")).toBeNull();
  });
});
