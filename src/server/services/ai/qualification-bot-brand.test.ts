import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ prisma: {} }));

import { systemFor } from "./qualification-bot";

describe("systemFor (marca en el prompt del bot)", () => {
  it("sin marca propia el bot sigue diciendo ProShop, igual que siempre", () => {
    const s = systemFor({ brandCompany: "ProShop", brandAssistant: null });
    expect(s).toContain("Soy el asistente de ProShop.");
  });

  it("con marca propia ya no menciona ProShop en ningún lado", () => {
    const s = systemFor({ brandCompany: "Acme Financiera", brandAssistant: null });
    expect(s).toContain("Soy el asistente de Acme Financiera.");
    expect(s).not.toContain("ProShop");
  });

  it("con nombre propio del asistente se presenta con él", () => {
    const s = systemFor({ brandCompany: "Acme Financiera", brandAssistant: "Lía" });
    expect(s).toContain("Soy Lía, el asistente de Acme Financiera.");
    expect(s).not.toContain("ProShop");
  });
});
