import { describe, expect, it } from "vitest";
import { checkMonthlyLimit, describeMonthlyUsage, monthStartUtc, nextMonthStartUtc } from "./ai-limit";

describe("checkMonthlyLimit", () => {
  it("sin topes nunca bloquea", () => {
    expect(checkMonthlyLimit({ budgetUsd: null, tokens: null }, { costUsd: 9999, tokens: 9e9 })).toEqual({ ok: true });
  });

  it("deja usar mientras esté por debajo", () => {
    expect(checkMonthlyLimit({ budgetUsd: 10, tokens: 1000 }, { costUsd: 9.99, tokens: 999 })).toEqual({ ok: true });
  });

  it("se detiene al llegar al tope de gasto (igual o más)", () => {
    const r = checkMonthlyLimit({ budgetUsd: 10, tokens: null }, { costUsd: 10, tokens: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("budget");
      expect(r.message).toMatch(/USD 10\.00/);
    }
  });

  it("se detiene al llegar al tope de tokens aunque el gasto esté bajo", () => {
    const r = checkMonthlyLimit({ budgetUsd: 100, tokens: 1000 }, { costUsd: 1, tokens: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tokens");
  });

  it("un tope de 0 deja la IA apagada", () => {
    expect(checkMonthlyLimit({ budgetUsd: 0, tokens: null }, { costUsd: 0, tokens: 0 }).ok).toBe(false);
  });
});

describe("mes", () => {
  it("calcula el inicio del mes y del siguiente, también en diciembre", () => {
    expect(monthStartUtc(new Date("2026-10-29T15:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(nextMonthStartUtc(new Date("2026-10-29T15:00:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextMonthStartUtc(new Date("2026-12-31T23:59:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("describeMonthlyUsage", () => {
  it("muestra el uso contra el tope", () => {
    expect(describeMonthlyUsage({ budgetUsd: 10, tokens: 500 }, { costUsd: 3.2, tokens: 120 })).toBe(
      "USD 3.20 de USD 10.00 · 120 de 500 tokens",
    );
    expect(describeMonthlyUsage({ budgetUsd: null, tokens: null }, { costUsd: 1, tokens: 7 })).toContain("sin tope");
  });
});
