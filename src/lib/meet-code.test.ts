import { describe, expect, it } from "vitest";
import { extractMeetCode, normalizeMeetUrl } from "./meet-code";

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

  it("código suelto, sin link", () => {
    expect(extractMeetCode("abc-defg-hij")).toBe("abc-defg-hij");
    expect(extractMeetCode("  ABC-defg-hij \n")).toBe("abc-defg-hij");
  });

  it("sin https, con www o con texto alrededor", () => {
    expect(extractMeetCode("meet.google.com/abc-defg-hij")).toBe("abc-defg-hij");
    expect(extractMeetCode("Únete: https://meet.google.com/abc-defg-hij?pli=1 gracias")).toBe("abc-defg-hij");
  });

  it("link envuelto por Google y enlace corto", () => {
    expect(extractMeetCode("https://www.google.com/url?q=https%3A%2F%2Fmeet.google.com%2Fabc-defg-hij&sa=D")).toBe("abc-defg-hij");
    expect(extractMeetCode("https://g.co/meet/mi-sala")).toBe("mi-sala");
  });
});

describe("normalizeMeetUrl", () => {
  it("deja siempre el link completo", () => {
    expect(normalizeMeetUrl("abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(normalizeMeetUrl("https://meet.google.com/meet/abc-defg-hij?authuser=0")).toBe("https://meet.google.com/abc-defg-hij");
  });
  it("no toca otros links ni vacíos", () => {
    expect(normalizeMeetUrl("https://zoom.us/j/1")).toBe("https://zoom.us/j/1");
    expect(normalizeMeetUrl("  ")).toBeNull();
    expect(normalizeMeetUrl(undefined)).toBeNull();
  });
});
