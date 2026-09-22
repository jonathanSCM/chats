import { describe, it, expect } from "vitest";
import { getZonedParts, zonedTimeToUtc } from "./timezone";

describe("zonedTimeToUtc", () => {
  it("convierte una hora de pared en La Paz (GMT-4, sin horario de verano) al instante UTC correcto", () => {
    const utc = zonedTimeToUtc(2026, 9, 22, 9, 0, "America/La_Paz");
    expect(utc.toISOString()).toBe("2026-09-22T13:00:00.000Z");
  });

  it("cruza la medianoche cuando la hora local + el offset pasa al día siguiente en UTC", () => {
    const utc = zonedTimeToUtc(2026, 9, 22, 22, 0, "America/La_Paz");
    expect(utc.toISOString()).toBe("2026-09-23T02:00:00.000Z");
  });

  it("funciona igual con una zona horaria distinta (Lima, GMT-5)", () => {
    const utc = zonedTimeToUtc(2026, 9, 22, 9, 0, "America/Lima");
    expect(utc.toISOString()).toBe("2026-09-22T14:00:00.000Z");
  });
});

describe("getZonedParts", () => {
  it("es la inversa de zonedTimeToUtc para la misma zona horaria", () => {
    const utc = zonedTimeToUtc(2026, 9, 22, 15, 30, "America/La_Paz");
    const parts = getZonedParts(utc, "America/La_Paz");
    expect(parts).toEqual({ year: 2026, month: 9, day: 22, hour: 15, minute: 30, weekday: 2 }); // martes
  });

  it("devuelve 0 (no 24) para la medianoche exacta", () => {
    const utc = zonedTimeToUtc(2026, 9, 22, 0, 0, "America/La_Paz");
    expect(getZonedParts(utc, "America/La_Paz").hour).toBe(0);
  });
});
