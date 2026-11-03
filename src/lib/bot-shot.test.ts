import { describe, expect, it } from "vitest";
import { classifyShotPage, shotFileName } from "./bot-shot";

describe("classifyShotPage", () => {
  it("reconoce la sala de Meet y la página de promoción de Google", () => {
    expect(classifyShotPage("https://meet.google.com/abc-defg-hij")).toBe("meet");
    expect(classifyShotPage("https://workspace.google.com/products/meet/?hl=en")).toBe("inactive");
    expect(classifyShotPage("https://meet.google.com/landing")).toBe("inactive");
    expect(classifyShotPage("https://accounts.google.com/v3/signin")).toBe("sign-in");
  });

  it("no concluye nada con páginas vacías o desconocidas", () => {
    expect(classifyShotPage("")).toBe("other");
    expect(classifyShotPage("about:blank")).toBe("other");
    expect(classifyShotPage("https://ejemplo.com")).toBe("other");
  });
});

describe("shotFileName", () => {
  it("arma un nombre legible con la etiqueta y el sitio", () => {
    expect(shotFileName("esperando-60s", "https://meet.google.com/abc-defg-hij")).toBe("captura · esperando-60s · meet.google.com.jpg");
    expect(shotFileName("../../x", "")).toBe("captura · x.jpg");
  });
});
