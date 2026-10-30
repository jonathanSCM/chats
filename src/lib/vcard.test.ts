import { describe, expect, it } from "vitest";
import { buildVCard, vcardFileName } from "./vcard";

describe("buildVCard", () => {
  it("arma una tarjeta completa con CRLF", () => {
    const v = buildVCard({
      fullName: "Ana María Pérez",
      phone: "51987654321",
      email: "ana@acme.pe",
      jobTitle: "Gerente",
      company: "Acme",
      city: "Lima",
      country: "Perú",
    });
    expect(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(v).toContain("FN:Ana María Pérez");
    expect(v).toContain("N:María Pérez;Ana;;;");
    expect(v).toContain("TEL;TYPE=CELL:+51987654321");
    expect(v).toContain("EMAIL;TYPE=INTERNET:ana@acme.pe");
    expect(v).toContain("ORG:Acme");
    expect(v).toContain("TITLE:Gerente");
    expect(v).toContain("ADR;TYPE=WORK:;;;Lima;;;Perú");
    expect(v.endsWith("END:VCARD\r\n")).toBe(true);
  });

  it("sin nombre usa el teléfono; los campos vacíos no se escriben", () => {
    const v = buildVCard({ fullName: null, phone: "51987654321" });
    expect(v).toContain("FN:51987654321");
    expect(v).not.toContain("EMAIL");
    expect(v).not.toContain("ORG");
    expect(v).not.toContain("ADR");
  });

  it("escapa comas, punto y coma, barras y saltos de línea para que no rompan la tarjeta", () => {
    const v = buildVCard({ fullName: "Pérez, Ana; \\ jefa", phone: "51987654321", company: "Acme, S.A.\nLima" });
    expect(v).toContain("FN:Pérez\\, Ana\\; \\\\ jefa");
    expect(v).toContain("ORG:Acme\\, S.A.\\nLima");
    // nadie puede colar una línea nueva de la tarjeta
    expect(v.split("\r\n").filter((l) => l.startsWith("TEL")).length).toBe(1);
  });

  it("con solo el país, no lo confunde con la ciudad", () => {
    expect(buildVCard({ fullName: "Ana", phone: "51987654321", country: "Perú" })).toContain("ADR;TYPE=WORK:;;;;;;Perú");
  });

  it("un usuario de WhatsApp sin número visible no lleva teléfono", () => {
    const v = buildVCard({ fullName: "Karla", phone: "PE.1859282925486474" });
    expect(v).not.toContain("TEL");
    expect(v).toContain("FN:Karla");
  });
});

describe("vcardFileName", () => {
  it("quita tildes y símbolos", () => {
    expect(vcardFileName({ fullName: "Ana María Pérez", phone: "519" })).toBe("ana-maria-perez.vcf");
    expect(vcardFileName({ fullName: null, phone: "51987654321" })).toBe("51987654321.vcf");
    expect(vcardFileName({ fullName: "***", phone: "PE.1" })).toBe("pe-1.vcf");
  });
});
