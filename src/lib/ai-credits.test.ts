import { describe, expect, it } from "vitest";
import {
  billableMinutes,
  canSpend,
  computeBalance,
  creditLevel,
  creditNoticeText,
  creditsForAudio,
  creditsForFeature,
  EMERGENCY_RESERVE,
  splitCharge,
  suggestedMonthlyCredits,
  usdToCredits,
} from "./ai-credits";

const now = new Date("2026-10-15T12:00:00Z");
const day = 86_400_000;
const pack = (id: string, credits: number, remaining: number, days: number) => ({
  id,
  credits,
  remaining,
  expiresAt: new Date(now.getTime() + days * day),
});

describe("créditos por función", () => {
  it("usa la tabla del modelo comercial", () => {
    expect(creditsForFeature("bot_calificacion")).toBe(2);
    expect(creditsForFeature("seguimiento")).toBe(3);
  });
  it("una función desconocida cuesta 1", () => {
    expect(creditsForFeature("nueva_cosa")).toBe(1);
  });
  it("la transcripción no cuesta créditos y el resumen con IA sí", () => {
    expect(creditsForAudio(15)).toBe(0);
    expect(creditsForAudio(90)).toBe(0);
    expect(creditsForFeature("transcripcion")).toBe(0);
    expect(creditsForFeature("meeting_summary")).toBe(15);
    expect(creditsForFeature("meeting_summary_live")).toBe(3);
  });
  it("redondea los minutos hacia arriba", () => {
    expect(billableMinutes(new Date(0), new Date(61_000))).toBe(2);
    expect(billableMinutes(new Date(0), new Date(1_000))).toBe(1);
    expect(billableMinutes(new Date(0), new Date(60 * 60_000))).toBe(60);
    expect(billableMinutes(new Date(5), new Date(5))).toBe(0);
  });
  it("escala sugerida: usuarios × 1.600", () => {
    expect(suggestedMonthlyCredits(5)).toBe(8_000);
    expect(suggestedMonthlyCredits(20)).toBe(32_000);
    expect(usdToCredits(3.82)).toBeCloseTo(3_820);
  });
});

describe("saldo", () => {
  it("sin plan de créditos no hay límite", () => {
    const b = computeBalance({ monthlyTotal: null, monthlyUsed: 0, packs: [], now });
    expect(creditLevel(b)).toBe("ok");
    expect(canSpend(b, { automatic: false, overdraft: 0 })).toBe(true);
  });
  it("mensual + paquetes vigentes; los vencidos no cuentan", () => {
    const b = computeBalance({
      monthlyTotal: 8_000,
      monthlyUsed: 6_000,
      packs: [pack("a", 2_000, 1_500, 30), pack("viejo", 2_000, 2_000, -1), pack("vacio", 2_000, 0, 10)],
      now,
    });
    expect(b.monthlyRemaining).toBe(2_000);
    expect(b.packsRemaining).toBe(1_500);
    expect(b.available).toBe(3_500);
    expect(b.granted).toBe(10_000);
    expect(b.percentUsed).toBe(65);
  });
  it("el mensual gastado de más no da saldo negativo", () => {
    const b = computeBalance({ monthlyTotal: 100, monthlyUsed: 130, packs: [], now });
    expect(b.available).toBe(0);
    expect(b.percentUsed).toBe(100);
  });
});

describe("reparto del cobro", () => {
  it("primero lo mensual, después el paquete que vence antes", () => {
    const packs = [pack("tarde", 1000, 1000, 80), pack("pronto", 1000, 300, 10)];
    const s = splitCharge(500, 100, packs, now);
    expect(s.fromMonthly).toBe(100);
    expect(s.fromPacks).toEqual([{ id: "pronto", amount: 300 }, { id: "tarde", amount: 100 }]);
    expect(s.uncovered).toBe(0);
  });
  it("lo que no alcanza queda como descubierto", () => {
    const s = splitCharge(50, 10, [pack("a", 20, 20, 5)], now);
    expect(s.fromMonthly).toBe(10);
    expect(s.fromPacks).toEqual([{ id: "a", amount: 20 }]);
    expect(s.uncovered).toBe(20);
  });
  it("no toca paquetes vencidos", () => {
    const s = splitCharge(10, 0, [pack("v", 100, 100, -2)], now);
    expect(s.fromPacks).toEqual([]);
    expect(s.uncovered).toBe(10);
  });
});

describe("avisos", () => {
  const level = (used: number, total = 1000) => creditLevel(computeBalance({ monthlyTotal: total, monthlyUsed: used, packs: [], now }));
  it("80%, 95% y agotado", () => {
    expect(level(790)).toBe("ok");
    expect(level(800)).toBe("warn80");
    expect(level(949)).toBe("warn80");
    expect(level(950)).toBe("warn95");
    expect(level(1000)).toBe("exhausted");
  });
  it("con un paquete con saldo no está agotado, aunque lo mensual sí", () => {
    const b = computeBalance({ monthlyTotal: 1000, monthlyUsed: 1000, packs: [pack("a", 500, 500, 30)], now });
    expect(creditLevel(b)).toBe("ok");
  });
  it("hay texto para cada nivel salvo ok", () => {
    const b = computeBalance({ monthlyTotal: 1000, monthlyUsed: 850, packs: [], now });
    expect(creditNoticeText("ok", b)).toBeNull();
    expect(creditNoticeText("warn80", b)).toContain("85%");
    expect(creditNoticeText("exhausted", b)).toContain("sigue funcionando");
  });
});

describe("corte y reserva de emergencia", () => {
  const empty = computeBalance({ monthlyTotal: 1000, monthlyUsed: 1000, packs: [], now });
  it("lo manual se detiene al llegar a 0", () => {
    expect(canSpend(empty, { automatic: false, overdraft: 0 })).toBe(false);
  });
  it("el bot sigue dentro de la reserva y se corta al pasarla", () => {
    expect(canSpend(empty, { automatic: true, overdraft: 0 })).toBe(true);
    expect(canSpend(empty, { automatic: true, overdraft: EMERGENCY_RESERVE - 1 })).toBe(true);
    expect(canSpend(empty, { automatic: true, overdraft: EMERGENCY_RESERVE })).toBe(false);
  });
});

describe("formato", () => {
  it("separa los miles con punto", async () => {
    const { formatCredits } = await import("./ai-credits");
    expect(formatCredits(999)).toBe("999");
    expect(formatCredits(1400)).toBe("1.400");
    expect(formatCredits(8000)).toBe("8.000");
    expect(formatCredits(1234567.4)).toBe("1.234.567");
  });
});

describe("equivalencias de créditos", () => {
  it("8.000 créditos son US$ 8 de presupuesto", async () => {
    const { creditEquivalents, formatDuration } = await import("./ai-credits");
    const e = creditEquivalents(8000);
    expect(e.usd).toBeCloseTo(8);
    expect(e.botReplies).toBe(4000);
    expect(e.analyses).toBe(2666);
    expect(e.meetingSummaries).toBe(533);
    expect(formatDuration(1600)).toBe("26 h 40 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
  });
});
