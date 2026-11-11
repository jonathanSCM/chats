import { describe, expect, it } from "vitest";
import { checkTranscriptText, cleanTranscriptText, joinPasted, TRANSCRIPT_MAX_CHARS } from "./transcript-upload";

describe("cleanTranscriptText", () => {
  it("de un .vtt deja solo lo hablado", () => {
    const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n<v Ana>Hola, buenas tardes\n\n2\n00:00:05.000 --> 00:00:08.000\n<v Luis>Quería ver los precios\n";
    expect(cleanTranscriptText(vtt)).toBe("Hola, buenas tardes\n\nQuería ver los precios");
  });

  it("de un .srt quita los números de bloque y los tiempos, pero conserva un número dicho", () => {
    const srt = "1\n00:00:01,000 --> 00:00:03,000\nSomos 12 personas\n\n2\n00:00:04,000 --> 00:00:06,000\nY vendemos 300\n";
    expect(cleanTranscriptText(srt)).toBe("Somos 12 personas\n\nY vendemos 300");
  });

  it("un texto normal queda igual (solo se compactan las líneas en blanco)", () => {
    expect(cleanTranscriptText("Ana: hola\r\n\r\n\r\n\r\nLuis: buenas  \n")).toBe("Ana: hola\n\nLuis: buenas");
  });
});

describe("checkTranscriptText / joinPasted", () => {
  it("rechaza lo muy corto y lo que pasa el máximo", () => {
    expect(checkTranscriptText("hola").ok).toBe(false);
    expect(checkTranscriptText("x".repeat(TRANSCRIPT_MAX_CHARS + 1)).ok).toBe(false);
    expect(checkTranscriptText("a".repeat(100))).toMatchObject({ ok: true });
  });

  it("une las etiquetas pegadas con lo escrito, sin vacíos", () => {
    expect(joinPasted(["uno", " dos "], " tres ")).toBe("uno\n\ndos\n\ntres");
    expect(joinPasted([], "")).toBe("");
  });
});
