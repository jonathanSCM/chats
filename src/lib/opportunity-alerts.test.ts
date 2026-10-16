import { describe, expect, it } from "vitest";
import { deriveAlerts } from "./opportunity-alerts";

const TODAY = "2026-10-15";

function row(overrides: Partial<Parameters<typeof deriveAlerts>[0]> = {}) {
  return {
    stage: { role: null },
    priority: null,
    leadScore: null,
    nextAction: "Llamar",
    nextActionAt: "2026-10-20T00:00:00.000Z",
    expectedCloseDate: null,
    updatedAt: "2026-10-14T10:00:00.000Z",
    assignedTo: "u1",
    ...overrides,
  } as Parameters<typeof deriveAlerts>[0];
}

describe("deriveAlerts (F13)", () => {
  it("no genera alertas ni destacados en etapas cerradas", () => {
    const r = deriveAlerts(row({ stage: { role: "WON" }, probability: 90 }), TODAY);
    expect(r).toEqual({ reasons: [], severity: null, highlights: [] });
  });

  it("destaca la alta probabilidad de cierre sin subir la severidad", () => {
    const r = deriveAlerts(row({ probability: 80 }), TODAY);
    expect(r.highlights).toHaveLength(1);
    expect(r.reasons).toEqual([]);
    expect(r.severity).toBeNull();
  });

  it("avisa propuesta sin respuesta pasados 5 días sin cambios", () => {
    const r = deriveAlerts(
      row({ proposalSentAt: "2026-10-08T12:00:00.000Z", updatedAt: "2026-10-08T12:00:00.000Z", authorityLevel: "Dueño" }),
      TODAY,
    );
    expect(r.reasons.some((x) => x.startsWith("Propuesta enviada hace 7"))).toBe(true);
  });

  it("no avisa propuesta sin respuesta si hubo movimiento posterior", () => {
    const r = deriveAlerts(
      row({ proposalSentAt: "2026-10-08T12:00:00.000Z", updatedAt: "2026-10-13T12:00:00.000Z", authorityLevel: "Dueño" }),
      TODAY,
    );
    expect(r.reasons.some((x) => x.startsWith("Propuesta"))).toBe(false);
  });

  it("avisa reunión sin seguimiento a los 3 días", () => {
    const r = deriveAlerts(
      row({ lastMeetingAt: "2026-10-11T15:00:00.000Z", updatedAt: "2026-10-11T15:00:00.000Z", authorityLevel: "Gerente" }),
      TODAY,
    );
    expect(r.reasons).toContain("Reunión sin seguimiento hace 4 días");
  });

  it("avisa que falta el decisor solo si ya hubo propuesta o reunión", () => {
    expect(deriveAlerts(row(), TODAY).reasons).not.toContain("Falta identificar al decisor");
    const r = deriveAlerts(row({ lastMeetingAt: "2026-10-14T10:00:00.000Z", updatedAt: "2026-10-15T10:00:00.000Z" }), TODAY);
    expect(r.reasons).toContain("Falta identificar al decisor");
  });
});
