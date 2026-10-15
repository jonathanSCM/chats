import { describe, expect, it } from "vitest";
import {
  MAX_TRANSCRIPT_CHARS,
  clampTranscript,
  parseMeetingSummary,
  pickTranscript,
  renderSummaryText,
  type MeetingSummaryData,
} from "./meeting-summary";

const base: MeetingSummaryData = {
  resumen: "Se habló de automatizar el seguimiento de clientes.",
  puntosClave: ["Hoy usan planillas"],
  decisiones: [],
  proximosPasos: [{ accion: "Enviar propuesta", responsable: "Carlos", fecha: "el viernes" }],
  informacionComercial: {
    necesidad: "Automatizar seguimiento",
    dolor: null,
    presupuesto: "Hasta 2.000 USD",
    decisor: null,
    urgencia: null,
    objeciones: ["Precio"],
    acuerdos: [],
  },
};

describe("pickTranscript", () => {
  it("devuelve la que exista", () => {
    expect(pickTranscript("hola", null)).toBe("hola");
    expect(pickTranscript(null, "audio")).toBe("audio");
    expect(pickTranscript(null, null)).toBe("");
  });

  it("prefiere los subtítulos (traen nombres) salvo que estén muy incompletos", () => {
    const audio = "a".repeat(1000);
    expect(pickTranscript("b".repeat(700), audio)).toBe("b".repeat(700));
    expect(pickTranscript("b".repeat(300), audio)).toBe(audio);
  });
});

describe("clampTranscript", () => {
  it("no toca textos dentro del tope", () => {
    expect(clampTranscript("corto")).toBe("corto");
  });

  it("conserva inicio y final de textos muy largos", () => {
    const long = "INICIO" + "x".repeat(MAX_TRANSCRIPT_CHARS * 2) + "FINAL";
    const out = clampTranscript(long);
    expect(out.startsWith("INICIO")).toBe(true);
    expect(out.endsWith("FINAL")).toBe(true);
    expect(out).toContain("se omitió una parte intermedia");
    expect(out.length).toBeLessThan(MAX_TRANSCRIPT_CHARS + 200);
  });
});

describe("renderSummaryText", () => {
  it("arma secciones solo con lo que hay", () => {
    const text = renderSummaryText(base);
    expect(text).toContain("RESUMEN\nSe habló de automatizar");
    expect(text).toContain("PRÓXIMOS PASOS\n- Enviar propuesta — responsable: Carlos — fecha: el viernes");
    expect(text).toContain("Necesidad: Automatizar seguimiento");
    expect(text).toContain("Objeciones: Precio");
    expect(text).not.toContain("DECISIONES");
    expect(text).not.toContain("Dolor:");
  });
});

describe("parseMeetingSummary", () => {
  it("acepta un resumen válido y rechaza uno incompleto", () => {
    expect(parseMeetingSummary(base).resumen).toBe(base.resumen);
    expect(() => parseMeetingSummary({ resumen: "solo esto" })).toThrow();
  });
});
