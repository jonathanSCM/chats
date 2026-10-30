import { describe, expect, it } from "vitest";
import { addMonths, creditPeriod, planStatus, planStatusNotice } from "./plan-period";

const utc = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h));
const day = 86_400_000;

describe("addMonths", () => {
  it("suma meses de calendario", () => {
    expect(addMonths(utc(2026, 10, 15), 1).toISOString()).toBe(utc(2026, 11, 15).toISOString());
    expect(addMonths(utc(2026, 12, 15), 1).toISOString()).toBe(utc(2027, 1, 15).toISOString());
  });
  it("si el día no existe queda el último del mes", () => {
    expect(addMonths(utc(2026, 1, 31), 1).toISOString()).toBe(utc(2026, 2, 28).toISOString());
    expect(addMonths(utc(2028, 1, 31), 1).toISOString()).toBe(utc(2028, 2, 29).toISOString());
  });
  it("restar meses también funciona", () => {
    expect(addMonths(utc(2026, 1, 10), -2).toISOString()).toBe(utc(2025, 11, 10).toISOString());
  });
});

describe("creditPeriod", () => {
  it("sin plan con fechas: el mes calendario en UTC", () => {
    const p = creditPeriod(null, utc(2026, 10, 15));
    expect(p.start.toISOString()).toBe(utc(2026, 10, 1).toISOString());
    expect(p.end.toISOString()).toBe(utc(2026, 11, 1).toISOString());
  });

  it("con plan: la bolsa se renueva cada mes el mismo día que empezó", () => {
    const anchor = utc(2026, 10, 15, 10);
    const first = creditPeriod(anchor, utc(2026, 10, 20));
    expect(first.start.toISOString()).toBe(anchor.toISOString());
    expect(first.end.toISOString()).toBe(utc(2026, 11, 15, 10).toISOString());

    const later = creditPeriod(anchor, utc(2026, 12, 20));
    expect(later.start.toISOString()).toBe(utc(2026, 12, 15, 10).toISOString());
    expect(later.end.toISOString()).toBe(utc(2027, 1, 15, 10).toISOString());
  });

  it("justo en el límite empieza el período nuevo", () => {
    const anchor = utc(2026, 10, 15);
    const p = creditPeriod(anchor, utc(2026, 11, 15));
    expect(p.start.toISOString()).toBe(utc(2026, 11, 15).toISOString());
  });

  it("un plan que empieza el 31 se renueva el último día de los meses cortos", () => {
    const anchor = utc(2026, 1, 31);
    const p = creditPeriod(anchor, utc(2026, 3, 1));
    expect(p.start.toISOString()).toBe(utc(2026, 2, 28).toISOString());
    expect(p.end.toISOString()).toBe(utc(2026, 3, 31).toISOString());
  });

  it("un ancla en el futuro cae al mes calendario", () => {
    const p = creditPeriod(utc(2027, 1, 1), utc(2026, 10, 15));
    expect(p.start.toISOString()).toBe(utc(2026, 10, 1).toISOString());
  });
});

describe("planStatus", () => {
  const end = utc(2026, 11, 30);
  it("sin fecha no vence nunca", () => {
    expect(planStatus(null, utc(2030, 1, 1))).toMatchObject({ state: "none", aiBlocked: false });
  });
  it("activo, por vencer, gracia y vencido", () => {
    expect(planStatus(end, new Date(end.getTime() - 20 * day))).toMatchObject({ state: "active", aiBlocked: false });
    expect(planStatus(end, new Date(end.getTime() - 3 * day))).toMatchObject({ state: "expiring", daysLeft: 3, aiBlocked: false });
    expect(planStatus(end, new Date(end.getTime() + 2 * day))).toMatchObject({ state: "grace", aiBlocked: false });
    expect(planStatus(end, new Date(end.getTime() + 5 * day + 1))).toMatchObject({ state: "expired", aiBlocked: true });
  });
  it("durante la gracia la IA sigue y al terminar se detiene", () => {
    expect(planStatus(end, new Date(end.getTime() + 4.9 * day)).aiBlocked).toBe(false);
    expect(planStatus(end, new Date(end.getTime() + 5.1 * day)).aiBlocked).toBe(true);
  });
  it("hay aviso solo cuando corresponde", () => {
    expect(planStatusNotice(planStatus(end, new Date(end.getTime() - 20 * day)), "30 nov")).toBeNull();
    expect(planStatusNotice(planStatus(end, new Date(end.getTime() - 3 * day)), "30 nov")).toContain("quedan 3 días");
    expect(planStatusNotice(planStatus(end, new Date(end.getTime() + 1 * day)), "30 nov")).toContain("días de gracia");
    expect(planStatusNotice(planStatus(end, new Date(end.getTime() + 9 * day)), "30 nov")).toContain("detenidos");
  });
});
