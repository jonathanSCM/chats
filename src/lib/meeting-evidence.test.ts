import { describe, expect, it } from "vitest";
import { MAX_MEETINGS_FOR_ANALYSIS, MAX_TRANSCRIPT_CHARS_PER_MEETING, renderMeetingEvidence, type MeetingForAnalysis } from "./meeting-evidence";

const meeting = (over: Partial<MeetingForAnalysis>): MeetingForAnalysis => ({
  scheduledAt: new Date("2026-11-05T12:00:00Z"),
  status: "DONE",
  notes: null,
  transcript: null,
  audioTranscript: null,
  aiSummary: null,
  ...over,
});

describe("renderMeetingEvidence", () => {
  it("sin nada útil devuelve null", () => {
    expect(renderMeetingEvidence([meeting({}), meeting({ notes: "  " })])).toBeNull();
  });

  it("incluye notas, resumen automático y transcripción de la reunión", () => {
    const text = renderMeetingEvidence([meeting({ notes: "Pidió demo", aiSummary: "Resumen: quiere CRM", audioTranscript: "Ana: necesito ordenar mis ventas" })]);
    expect(text).toContain("Reunión del 2026-11-05");
    expect(text).toContain("Notas cargadas por el vendedor:\nPidió demo");
    expect(text).toContain("Resumen automático de la reunión:\nResumen: quiere CRM");
    expect(text).toContain("Transcripción:\nAna: necesito ordenar mis ventas");
  });

  it("una transcripción larga se acota (inicio y final) y solo entran las primeras reuniones", () => {
    const long = `INICIO${"x".repeat(MAX_TRANSCRIPT_CHARS_PER_MEETING * 3)}FINAL`;
    const text = renderMeetingEvidence(Array.from({ length: MAX_MEETINGS_FOR_ANALYSIS + 2 }, () => meeting({ transcript: long }))) ?? "";
    expect(text).toContain("INICIO");
    expect(text).toContain("FINAL");
    expect(text).toContain("parte intermedia omitida");
    expect(text.match(/--- Reunión del/g)).toHaveLength(MAX_MEETINGS_FOR_ANALYSIS);
    expect(text.length).toBeLessThan(MAX_MEETINGS_FOR_ANALYSIS * (MAX_TRANSCRIPT_CHARS_PER_MEETING + 600));
  });
});

describe("renderMeetingEvidence con las dos fuentes", () => {
  it("manda subtítulos (con nombres) y audio rotulados para que la IA los concilie", () => {
    const text = renderMeetingEvidence([meeting({ transcript: "Ana: necesito un CRM", audioTranscript: "necesito un CRM para mi tienda de ropa" })]) ?? "";
    expect(text).toContain("FUENTE A — SUBTÍTULOS DE MEET");
    expect(text).toContain("Ana: necesito un CRM");
    expect(text).toContain("FUENTE B — TRANSCRIPCIÓN DEL AUDIO");
    expect(text).toContain("tienda de ropa");
  });

  it("con una sola fuente no pone rótulos", () => {
    const text = renderMeetingEvidence([meeting({ audioTranscript: "solo audio" })]) ?? "";
    expect(text).toContain("Transcripción:\nsolo audio");
    expect(text).not.toContain("FUENTE A");
  });

  it("una fuente larga no se come a la otra: ambas conservan inicio y final", () => {
    const long = (tag: string) => `${tag}-INICIO ${"x".repeat(MAX_TRANSCRIPT_CHARS_PER_MEETING * 2)} ${tag}-FINAL`;
    const text = renderMeetingEvidence([meeting({ transcript: long("SUB"), audioTranscript: long("AUD") })]) ?? "";
    for (const mark of ["SUB-INICIO", "SUB-FINAL", "AUD-INICIO", "AUD-FINAL"]) expect(text).toContain(mark);
  });
});
