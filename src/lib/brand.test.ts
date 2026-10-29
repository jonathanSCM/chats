import { describe, expect, it } from "vitest";
import {
  accentStyle,
  assistantDisplayName,
  botCompanyName,
  contrastWithWhite,
  detectLogoType,
  isUsableBrandColor,
  resolveBrand,
} from "./brand";

const org = {
  id: "o1",
  canCustomizeBrand: true,
  brandName: "Acme Financiera",
  brandColor: "#1d4ed8",
  assistantName: "Lía",
  brandLogoVersion: 3,
};

describe("resolveBrand", () => {
  it("con el plan habilitado usa la marca propia", () => {
    const b = resolveBrand(org);
    expect(b).toEqual({
      custom: true,
      name: "Acme Financiera",
      color: "#1d4ed8",
      assistantName: "Lía",
      logoPath: "/api/brand-logo/o1?v=3",
    });
  });

  it("con el plan apagado ignora lo guardado, sin borrarlo", () => {
    const b = resolveBrand({ ...org, canCustomizeBrand: false });
    expect(b).toEqual({ custom: false, name: null, color: null, assistantName: null, logoPath: null });
  });

  it("sin nada cargado no hay marca propia", () => {
    const b = resolveBrand({ ...org, brandName: " ", brandColor: null, assistantName: null, brandLogoVersion: 0 });
    expect(b.custom).toBe(false);
    expect(b.logoPath).toBeNull();
  });

  it("un color que no se lee con texto blanco se descarta", () => {
    expect(resolveBrand({ ...org, brandColor: "#ffff00" }).color).toBeNull();
  });
});

describe("nombres", () => {
  it("el asistente usa su nombre propio o 'Asistente de {marca}'", () => {
    expect(assistantDisplayName(resolveBrand(org), "Org")).toBe("Lía");
    expect(assistantDisplayName(resolveBrand({ ...org, assistantName: null }), "Org")).toBe("Asistente de Acme Financiera");
    expect(assistantDisplayName(resolveBrand({ ...org, canCustomizeBrand: false }), "Mi Org")).toBe("Asistente de Mi Org");
  });

  it("el bot de WhatsApp conserva 'ProShop' si no hay marca propia", () => {
    expect(botCompanyName(resolveBrand(org))).toBe("Acme Financiera");
    expect(botCompanyName(resolveBrand({ ...org, canCustomizeBrand: false }))).toBe("ProShop");
  });
});

describe("color", () => {
  it("acepta colores oscuros y rechaza claros o mal escritos", () => {
    expect(isUsableBrandColor("#1d4ed8")).toBe(true);
    expect(isUsableBrandColor("#7c5cff")).toBe(true);
    expect(isUsableBrandColor("#ffff00")).toBe(false);
    expect(isUsableBrandColor("azul")).toBe(false);
    expect(isUsableBrandColor("#12345")).toBe(false);
  });

  it("calcula el contraste contra blanco", () => {
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 0);
    expect(contrastWithWhite("#ffffff")).toBeCloseTo(1, 1);
  });

  it("genera las variables CSS solo si hay color", () => {
    expect(accentStyle(null)).toBeUndefined();
    expect(accentStyle("#1d4ed8")?.["--accent"]).toBe("#1d4ed8");
  });
});

describe("detectLogoType", () => {
  it("reconoce PNG, JPEG y WebP por su contenido", () => {
    expect(detectLogoType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectLogoType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectLogoType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
  });

  it("rechaza SVG, HTML y archivos vacíos aunque se llamen .png", () => {
    expect(detectLogoType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(detectLogoType(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectLogoType(new Uint8Array())).toBeNull();
  });
});
