import { describe, expect, it } from "vitest";
import {
  changedKeys,
  describeChanges,
  describePlan,
  formatPriceSoles,
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

describe("precio", () => {
  it("formatea en soles", () => {
    expect(formatPriceSoles(249)).toBe("S/ 249");
    expect(formatPriceSoles(249.5)).toBe("S/ 249,50");
    expect(formatPriceSoles(null)).toBe("Sin precio");
  });
});
