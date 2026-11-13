import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ prisma: {} }));

import { appendRecordingText, recordingHeader } from "./extension-meeting";

const AT = new Date("2026-11-13T19:42:00Z"); // 15:42 en La Paz (UTC-4)

describe("grabaciones separadas dentro de una misma reunión", () => {
  it("el encabezado lleva fecha y hora en la zona de la organización", () => {
    expect(recordingHeader(AT, "America/La_Paz")).toBe("── Grabación del 13 de noviembre de 2026, 15:42 ──");
  });

  it("la primera grabación de una reunión vacía no lleva encabezado (si no la eligió la persona)", () => {
    expect(appendRecordingText({ existing: null, addition: "Ana: hola", startsRecording: true, chosenByPerson: false, at: AT })).toBe("Ana: hola");
  });

  it("una reunión elegida a propósito abre sección con fecha y hora aunque esté vacía", () => {
    expect(appendRecordingText({ existing: null, addition: "Ana: hola", startsRecording: true, chosenByPerson: true, at: AT, timeZone: "America/La_Paz" })).toBe(
      "── Grabación del 13 de noviembre de 2026, 15:42 ──\nAna: hola",
    );
  });

  it("una segunda grabación NO se mezcla: queda como sección nueva debajo de la anterior", () => {
    const first = appendRecordingText({ existing: null, addition: "Ana: hola", startsRecording: true, chosenByPerson: true, at: AT, timeZone: "America/La_Paz" });
    const second = appendRecordingText({ existing: first, addition: "Luis: buenas", startsRecording: true, chosenByPerson: true, at: new Date("2026-11-13T21:00:00Z"), timeZone: "America/La_Paz" });
    expect(second).toContain("── Grabación del 13 de noviembre de 2026, 15:42 ──\nAna: hola");
    expect(second).toContain("\n\n── Grabación del 13 de noviembre de 2026, 17:00 ──\nLuis: buenas");
  });

  it("las partes siguientes de la MISMA grabación se pegan sin encabezado nuevo", () => {
    const first = appendRecordingText({ existing: null, addition: "Ana: hola", startsRecording: true, chosenByPerson: true, at: AT, timeZone: "America/La_Paz" });
    const next = appendRecordingText({ existing: first, addition: "Ana: seguimos", startsRecording: false, chosenByPerson: true, at: AT, timeZone: "America/La_Paz" });
    expect(next.match(/── Grabación/g)).toHaveLength(1);
    expect(next.endsWith("\n\nAna: seguimos")).toBe(true);
  });
});
