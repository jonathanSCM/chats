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
