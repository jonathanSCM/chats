import { describe, expect, it } from "vitest";
import {
  changedKeys,
  describeChanges,
  describePlan,
  formatPrice,
  parseCurrency,
  sumByCurrency,
  normalizePlanValues,
  planChangeNotice,
  type PlanValues,
} from "./plans";

const gla: PlanValues = {
  maxAdmins: 1,
  maxSellers: 4,
  canHaveSubOrgs: false,
  maxSubOrgs: null,
  canCustomizeBrand: false,
  aiCreditsMonthly: 8000,
};

describe("plan", () => {
  it("sin suborganizaciones el tope se vacía", () => {
    expect(normalizePlanValues({ ...gla, canHaveSubOrgs: false, maxSubOrgs: 5 }).maxSubOrgs).toBeNull();
    expect(normalizePlanValues({ ...gla, canHaveSubOrgs: true, maxSubOrgs: 5 }).maxSubOrgs).toBe(5);
  });

  it("describe lo que incluye", () => {
    expect(describePlan(gla)).toEqual([
      "1 administrador",
      "4 vendedores",
      "sin suborganizaciones",
      "sin marca propia",
      "8.000 créditos de IA por mes",
    ]);
    expect(describePlan({ ...gla, maxAdmins: null, aiCreditsMonthly: null })[0]).toBe("administradores sin límite");
  });

  it("detecta solo lo que cambió", () => {
    expect(changedKeys(gla, gla)).toEqual([]);
    expect(changedKeys(gla, { ...gla, aiCreditsMonthly: 10000, maxSellers: 6 })).toEqual(["maxSellers", "aiCreditsMonthly"]);
    // un tope de suborganizaciones que no aplica (están apagadas) no cuenta como cambio
    expect(changedKeys(gla, { ...gla, maxSubOrgs: 9 })).toEqual([]);
    expect(changedKeys(gla, { ...gla, canHaveSubOrgs: true, maxSubOrgs: 2 })).toEqual(["canHaveSubOrgs"]);
  });

  it("muestra antes y después", () => {
    expect(describeChanges(gla, { ...gla, aiCreditsMonthly: 10000 })).toEqual([
      "8.000 créditos de IA por mes → 10.000 créditos de IA por mes",
    ]);
  });
});

describe("aviso de cambio de plan", () => {
  it("no hay aviso si no cambió nada", () => {
    expect(planChangeNotice({ planName: "GLA", before: gla, after: gla })).toBeNull();
  });

  it("al editar el plan lista los cambios y lo que incluye ahora", () => {
    const text = planChangeNotice({ planName: "GLA", before: gla, after: { ...gla, aiCreditsMonthly: 10000 } });
    expect(text).toContain('Tu plan "GLA" se actualizó.');
    expect(text).toContain("• 8.000 créditos de IA por mes → 10.000 créditos de IA por mes");
    expect(text).toContain("• 10.000 créditos de IA por mes");
  });

  it("al cambiar de plan avisa aunque los valores coincidan", () => {
    const text = planChangeNotice({ planName: "Pro", before: gla, after: gla, previousPlanName: "GLA" });
    expect(text).toContain('Tu plan pasó de "GLA" a "Pro".');
    expect(text).not.toContain("Qué cambió");
  });
});

describe("precio y moneda", () => {
  it("formatea según la moneda", () => {
    expect(formatPrice(249, "PEN")).toBe("S/ 249");
    expect(formatPrice(249.5, "PEN")).toBe("S/ 249,50");
    expect(formatPrice(59, "USD")).toBe("US$ 59");
    expect(formatPrice(300, "BOB")).toBe("Bs 300");
    expect(formatPrice(50, "EUR")).toBe("€ 50");
    expect(formatPrice(null, "PEN")).toBe("Sin precio");
  });

  it("una moneda desconocida cae en soles", () => {
    expect(parseCurrency("USD")).toBe("USD");
    expect(parseCurrency("XYZ")).toBe("PEN");
    expect(parseCurrency(undefined)).toBe("PEN");
  });

  it("suma por cliente y por moneda, sin mezclar", () => {
    const totals = sumByCurrency([
      { price: 249, currency: "PEN", clients: 2 },
      { price: 59, currency: "USD", clients: 3 },
      { price: 100, currency: "PEN", clients: 1 },
      { price: null, currency: "PEN", clients: 5 },
      { price: 80, currency: "EUR", clients: 0 },
    ]);
    expect(totals).toEqual([
      { currency: "PEN", total: 598 },
      { currency: "USD", total: 177 },
    ]);
  });
});
