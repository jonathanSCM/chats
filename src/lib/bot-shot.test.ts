import { describe, expect, it } from "vitest";
import { SHOT_REASONS, classifyShotPage, shotFailureReason, shotFileName } from "./bot-shot";

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

describe("shotFailureReason", () => {
  it("si ya había pedido entrar y Meet lo echó, dice que lo bloqueó (no que la reunión no existe)", () => {
    expect(shotFailureReason("inactive", true)).toBe(SHOT_REASONS.blocked);
    expect(shotFailureReason("inactive", true)).toMatch(/Workspace/);
    expect(shotFailureReason("inactive", true)).not.toMatch(/ya no estaba activa/);
  });

  it("si nunca llegó a la sala, la reunión no se abrió (pero también menciona Workspace)", () => {
    expect(shotFailureReason("inactive", false)).toBe(SHOT_REASONS.inactive);
    expect(shotFailureReason("inactive", false)).toMatch(/Workspace/);
  });

  it("el pedido de iniciar sesión se explica igual con o sin sala de espera", () => {
    expect(shotFailureReason("sign-in", false)).toBe(SHOT_REASONS["sign-in"]);
    expect(shotFailureReason("sign-in", true)).toBe(SHOT_REASONS["sign-in"]);
  });
});

describe("shotFileName", () => {
  it("arma un nombre legible con la etiqueta y el sitio", () => {
    expect(shotFileName("esperando-60s", "https://meet.google.com/abc-defg-hij")).toBe("captura · esperando-60s · meet.google.com.jpg");
    expect(shotFileName("../../x", "")).toBe("captura · x.jpg");
  });
});
