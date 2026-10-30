import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  orgFind: vi.fn(),
  orgUpdate: vi.fn(),
  orgUpdateMany: vi.fn(),
  orgFindMany: vi.fn(),
  aggregate: vi.fn(),
  analysisCreate: vi.fn(),
  settingUpsert: vi.fn(),
  settingUpdateMany: vi.fn(),
  responsesCreate: vi.fn(),
  assertCredits: vi.fn(),
  charge: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    organization: { findUnique: m.orgFind, update: m.orgUpdate, updateMany: m.orgUpdateMany, findMany: m.orgFindMany },
    aiAnalysis: { aggregate: m.aggregate, create: m.analysisCreate },
    platformSetting: { upsert: m.settingUpsert, updateMany: m.settingUpdateMany },
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (enc: string) => `sk-own-${enc}` }));
vi.mock("openai", () => ({
  default: class FakeOpenAI {
    responses = { create: (...args: unknown[]) => m.responsesCreate(...args) };
  },
}));
vi.mock("./credits", () => {
  class AiCreditsExhaustedError extends Error {}
  return { AiCreditsExhaustedError, assertCreditsAvailable: m.assertCredits, chargeCredits: m.charge };
});

import { AiBudgetExceededError, AiCreditsError, runStructured } from "./client";
import { AiCreditsExhaustedError } from "./credits";

const options = {
  organizationId: "org1",
  userId: "user1",
  entityType: "Opportunity",
  entityId: "opp1",
  analysisType: "seguimiento",
  promptVersion: "v1",
  model: "m",
  system: "s",
  input: "i",
  schemaName: "n",
  schema: {},
  parse: (raw: unknown) => raw as { ok: boolean },
};

const platformOrg = {
  id: "org1",
  aiMode: "platform",
  openaiKeyEnc: null,
  customKeyEnc: null,
  aiKeyAlertMessage: null,
  aiMonthlyBudgetUsd: null,
  aiMonthlyTokenLimit: null,
  parent: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "sk-platform";
  m.aggregate.mockResolvedValue({ _sum: { costEstimate: 0, inputTokens: 0, outputTokens: 0 } });
  m.orgFind.mockResolvedValue(platformOrg);
  m.responsesCreate.mockResolvedValue({ output_text: '{"ok":true}', usage: { input_tokens: 4000, output_tokens: 1000 } });
  m.assertCredits.mockResolvedValue(undefined);
  m.charge.mockResolvedValue(undefined);
});

describe("runStructured y créditos de IA", () => {
  it("con la clave de la plataforma comprueba el saldo y descuenta los créditos de la función", async () => {
    await runStructured(options);
    expect(m.assertCredits).toHaveBeenCalledWith("org1", "seguimiento");
    expect(m.charge).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org1",
        userId: "user1",
        feature: "seguimiento",
        credits: 3,
        inputTokens: 4000,
        outputTokens: 1000,
        entityId: "opp1",
      }),
    );
  });

  it("el bot cuesta 2 créditos y queda como proceso automático (sin usuario)", async () => {
    await runStructured({ ...options, userId: undefined, analysisType: "bot_calificacion" });
    expect(m.charge).toHaveBeenCalledWith(expect.objectContaining({ feature: "bot_calificacion", credits: 2, userId: null }));
  });

  it("sin créditos no llama a OpenAI y avisa con un error de presupuesto", async () => {
    m.assertCredits.mockRejectedValue(new AiCreditsExhaustedError("Se acabaron los créditos"));
    const error = await runStructured(options).catch((e) => e);
    expect(error).toBeInstanceOf(AiCreditsError);
    expect(error).toBeInstanceOf(AiBudgetExceededError);
    expect(error.message).toBe("Se acabaron los créditos");
    expect(m.responsesCreate).not.toHaveBeenCalled();
    expect(m.charge).not.toHaveBeenCalled();
  });

  it("con clave propia no se cobran créditos", async () => {
    m.orgFind.mockResolvedValue({ ...platformOrg, aiMode: "own", openaiKeyEnc: "abc" });
    await runStructured(options);
    expect(m.assertCredits).not.toHaveBeenCalled();
    expect(m.charge).not.toHaveBeenCalled();
  });

  it("si falla la anotación de créditos el análisis igual se devuelve", async () => {
    m.charge.mockRejectedValue(new Error("db caída"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runStructured(options)).resolves.toEqual({ ok: true });
    spy.mockRestore();
  });

  it("una llamada que falla no cobra créditos", async () => {
    m.responsesCreate.mockRejectedValue(new Error("boom"));
    await expect(runStructured(options)).rejects.toThrow("boom");
    expect(m.charge).not.toHaveBeenCalled();
  });
});
