import { describe, expect, it } from "vitest";
import { adInsightsRange, todayInZone } from "./meta-ads-window";

// 24/10 02:50 UTC = 23/10 22:50 en Bolivia (UTC-4): "hoy" para la cuenta es el 23.
const NOW = new Date("2026-10-24T02:50:00Z");

describe("todayInZone", () => {
  it("usa la zona de la cuenta, no la del servidor", () => {
    expect(todayInZone("America/La_Paz", NOW)).toBe("2026-10-23");
    expect(todayInZone("UTC", NOW)).toBe("2026-10-24");
  });
  it("si la zona no existe, cae en la de Bolivia", () => {
    expect(todayInZone("No/Existe", NOW)).toBe("2026-10-23");
    expect(todayInZone(null, NOW)).toBe("2026-10-23");
  });
});

describe("adInsightsRange", () => {
  it("termina HOY (la campaña de hoy entra, que era el problema)", () => {
    expect(adInsightsRange(undefined, true, "America/La_Paz", NOW)).toEqual({ since: "2026-10-16", until: "2026-10-23" });
  });
  it("la primera vez trae 90 días de historia", () => {
    expect(adInsightsRange(undefined, false, "America/La_Paz", NOW)).toEqual({ since: "2026-07-25", until: "2026-10-23" });
  });
  it("respeta las ventanas con nombre", () => {
    expect(adInsightsRange("last_30d", true, "America/La_Paz", NOW).since).toBe("2026-09-23");
    expect(adInsightsRange("last_year", true, "America/La_Paz", NOW).since).toBe("2025-10-23");
    expect(adInsightsRange("last_90d", true, "America/La_Paz", NOW).since).toBe("2026-07-25");
  });
  it("cruza el fin de mes y de año sin errores", () => {
    const jan = new Date("2027-01-03T12:00:00Z");
    expect(adInsightsRange("last_7d", true, "America/La_Paz", jan)).toEqual({ since: "2026-12-27", until: "2027-01-03" });
  });
});
