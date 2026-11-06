import { describe, it, expect } from "vitest";
import { getZonedParts, zonedTimeToUtc, zoneLabel } from "./timezone";

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

describe("zonedTimeToUtc cerca de un cambio de horario de verano", () => {
  it("una hora poco después del cambio de primavera (Nueva York, 8-mar-2026) queda en el instante correcto", () => {
    // El cambio fue a las 2:00 (7:00 UTC); las 3:00 ya son EDT (GMT-4) = 7:00 UTC.
    expect(zonedTimeToUtc(2026, 3, 8, 3, 0, "America/New_York").toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(zonedTimeToUtc(2026, 3, 8, 9, 0, "America/New_York").toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("una hora de pared normal antes del cambio sigue en horario estándar", () => {
    expect(zonedTimeToUtc(2026, 3, 8, 1, 0, "America/New_York").toISOString()).toBe("2026-03-08T06:00:00.000Z");
  });

  it("en una zona sin horario de verano no cambia nada (Lima)", () => {
    expect(zonedTimeToUtc(2026, 3, 8, 3, 0, "America/Lima").toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });
});

describe("zoneLabel", () => {
  it("nombra la zona con su ciudad y su desfase", () => {
    expect(zoneLabel("America/Lima", new Date("2026-11-06T12:00:00Z"))).toBe("Lima (GMT-5)");
    expect(zoneLabel("America/La_Paz", new Date("2026-11-06T12:00:00Z"))).toBe("La Paz (GMT-4)");
    expect(zoneLabel("America/Argentina/Buenos_Aires", new Date("2026-11-06T12:00:00Z"))).toBe("Buenos Aires (GMT-3)");
  });

  it("sigue el horario de verano de la fecha consultada", () => {
    expect(zoneLabel("America/New_York", new Date("2026-07-01T12:00:00Z"))).toBe("New York (GMT-4)");
    expect(zoneLabel("America/New_York", new Date("2026-12-01T12:00:00Z"))).toBe("New York (GMT-5)");
  });

  it("con una zona inválida no falla: devuelve solo el nombre", () => {
    expect(zoneLabel("Zona/Inexistente")).toBe("Inexistente");
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
