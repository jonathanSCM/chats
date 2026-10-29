import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  orgFind: vi.fn(),
  orgUpdate: vi.fn(),
  orgUpdateMany: vi.fn(),
  aggregate: vi.fn(),
  orgFindMany: vi.fn(),
  analysisCreate: vi.fn(),
  settingUpsert: vi.fn(),
  settingUpdateMany: vi.fn(),
  responsesCreate: vi.fn(),
  keysSeen: [] as string[],
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
    responses: { create: (...args: unknown[]) => unknown };
    constructor(opts: { apiKey: string }) {
      // Los clientes se reutilizan entre llamadas: se anota con qué clave se HIZO cada pedido, no cuándo se creó el cliente.
      this.responses = {
        create: (...args: unknown[]) => {
          m.keysSeen.push(opts.apiKey);
          return m.responsesCreate(...args);
        },
      };
    }
  },
}));

import { AiBudgetExceededError, AiMonthlyLimitError, AiOwnKeyError, runStructured } from "./client";

const options = {
  organizationId: "org1",
  entityType: "X",
  entityId: "1",
  analysisType: "t",
  promptVersion: "v1",
  model: "m",
  system: "s",
  input: "i",
  schemaName: "n",
  schema: {},
  parse: (raw: unknown) => raw as { ok: boolean },
};

const okResponse = { output_text: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 1 } };

const orgWith = (over: Record<string, unknown>) => ({
  id: "org1",
  aiMode: "platform",
  openaiKeyEnc: null,
  customKeyEnc: null,
  aiKeyAlertMessage: null,
  aiMonthlyBudgetUsd: null,
  aiMonthlyTokenLimit: null,
  parent: null,
  ...over,
});

const parentWith = (over: Record<string, unknown>) => ({
  id: "padre",
  aiMode: "platform",
  openaiKeyEnc: null,
  customKeyEnc: null,
  aiKeyAlertMessage: null,
  aiMonthlyBudgetUsd: null,
  aiMonthlyTokenLimit: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.keysSeen.length = 0;
  process.env.OPENAI_API_KEY = "sk-platform";
  process.env.AI_ENABLED = "true";
  m.aggregate.mockResolvedValue({ _sum: { costEstimate: 0, inputTokens: 0, outputTokens: 0 } });
  m.orgFindMany.mockResolvedValue([]);
  m.analysisCreate.mockResolvedValue({});
  m.orgUpdate.mockResolvedValue({});
  m.orgUpdateMany.mockResolvedValue({});
  m.settingUpdateMany.mockResolvedValue({});
  m.responsesCreate.mockResolvedValue(okResponse);
});

describe("runStructured con clave propia", () => {
  it("sin clave propia usa la de la plataforma y respeta el tope diario", async () => {
    m.orgFind.mockResolvedValue(orgWith({}));
    await runStructured(options);
    expect(m.aggregate).toHaveBeenCalled();
    expect(m.keysSeen).toContain("sk-platform");

    m.aggregate.mockResolvedValue({ _sum: { costEstimate: 999 } });
    await expect(runStructured(options)).rejects.toBeInstanceOf(AiBudgetExceededError);
  });

  it("con clave propia usa la del cliente y no aplica el tope de la plataforma", async () => {
    m.orgFind.mockResolvedValue(orgWith({ aiMode: "own", openaiKeyEnc: "AAA" }));
    m.aggregate.mockResolvedValue({ _sum: { costEstimate: 999 } });
    await runStructured(options);
    expect(m.keysSeen).toContain("sk-own-AAA");
    expect(m.keysSeen).not.toContain("sk-platform");
    expect(m.aggregate).not.toHaveBeenCalled();
  });

  it("una suborganización usa la clave de su padre", async () => {
    m.orgFind.mockResolvedValue(
      orgWith({ parent: parentWith({ aiMode: "own", openaiKeyEnc: "PPP" }) }),
    );
    await runStructured(options);
    expect(m.keysSeen).toContain("sk-own-PPP");
  });

  it("si la clave propia falla de forma definitiva, deja el aviso para el dueño", async () => {
    m.orgFind.mockResolvedValue(orgWith({ aiMode: "own", openaiKeyEnc: "AAA" }));
    m.responsesCreate.mockRejectedValue({ status: 401, message: "Incorrect API key" });
    await expect(runStructured(options)).rejects.toBeTruthy();
    expect(m.orgUpdate).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: { aiKeyAlertAt: expect.any(Date), aiKeyAlertMessage: expect.stringMatching(/clave/i) },
    });
    expect(m.settingUpsert).not.toHaveBeenCalled(); // el aviso global de la plataforma no se toca
  });

  it("un límite de velocidad pasajero no bloquea la IA del cliente", async () => {
    m.orgFind.mockResolvedValue(orgWith({ aiMode: "own", openaiKeyEnc: "AAA" }));
    m.responsesCreate.mockRejectedValue({ status: 429, code: "rate_limit_exceeded", message: "slow down" });
    await expect(runStructured(options)).rejects.toBeTruthy();
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("con aviso activo se detiene y NO usa la clave de la plataforma", async () => {
    m.orgFind.mockResolvedValue(
      orgWith({ aiMode: "own", openaiKeyEnc: "AAA", aiKeyAlertMessage: "Tu cuenta de OpenAI se quedó sin saldo." }),
    );
    await expect(runStructured(options)).rejects.toBeInstanceOf(AiOwnKeyError);
    await expect(runStructured(options)).rejects.toThrow(/sin saldo/);
    expect(m.responsesCreate).not.toHaveBeenCalled();
    expect(m.keysSeen).toHaveLength(0);
  });

  it("sin clave guardada todavía, el modo propia sigue usando la de la plataforma", async () => {
    m.orgFind.mockResolvedValue(orgWith({ aiMode: "own" }));
    await runStructured(options);
    expect(m.keysSeen).toContain("sk-platform");
  });

  it("una llamada que funciona limpia el aviso viejo de la clave propia", async () => {
    m.orgFind.mockResolvedValue(orgWith({ aiMode: "own", openaiKeyEnc: "AAA" }));
    await runStructured(options);
    expect(m.orgUpdateMany).toHaveBeenCalledWith({
      where: { id: "org1", aiKeyAlertAt: { not: null } },
      data: { aiKeyAlertAt: null, aiKeyAlertMessage: null },
    });
  });
});

describe("runStructured con clave personalizada y tope mensual", () => {
  const custom = (over: Record<string, unknown> = {}) =>
    orgWith({ aiMode: "custom", customKeyEnc: "CCC", openaiKeyEnc: "no-se-usa", ...over });

  it("usa la clave personalizada (no la propia ni la de la plataforma)", async () => {
    m.orgFind.mockResolvedValue(custom());
    await runStructured(options);
    expect(m.keysSeen).toContain("sk-own-CCC");
    expect(m.keysSeen).not.toContain("sk-own-no-se-usa");
    expect(m.keysSeen).not.toContain("sk-platform");
  });

  it("con gasto bajo el tope, trabaja normal", async () => {
    m.orgFind.mockResolvedValue(custom({ aiMonthlyBudgetUsd: 10 }));
    m.aggregate.mockResolvedValue({ _sum: { costEstimate: 9.5, inputTokens: 10, outputTokens: 10 } });
    await runStructured(options);
    expect(m.responsesCreate).toHaveBeenCalledTimes(1);
  });

  it("al llegar al tope de gasto del mes, se detiene SIN llamar a OpenAI ni caer a la plataforma", async () => {
    m.orgFind.mockResolvedValue(custom({ aiMonthlyBudgetUsd: 10 }));
    m.aggregate.mockResolvedValue({ _sum: { costEstimate: 10, inputTokens: 1, outputTokens: 1 } });
    await expect(runStructured(options)).rejects.toBeInstanceOf(AiMonthlyLimitError);
    await expect(runStructured(options)).rejects.toThrow(/límite mensual/i);
    expect(m.responsesCreate).not.toHaveBeenCalled();
  });

  it("al llegar al tope de tokens del mes, también se detiene (entrada + salida)", async () => {
    m.orgFind.mockResolvedValue(custom({ aiMonthlyTokenLimit: 1000 }));
    m.aggregate.mockResolvedValue({ _sum: { costEstimate: 0.01, inputTokens: 600, outputTokens: 400 } });
    await expect(runStructured(options)).rejects.toBeInstanceOf(AiMonthlyLimitError);
    expect(m.responsesCreate).not.toHaveBeenCalled();
  });

  it("el gasto del mes cuenta a la organización y a sus suborganizaciones juntas", async () => {
    m.orgFind.mockResolvedValue(custom({ aiMonthlyBudgetUsd: 10 }));
    m.orgFindMany.mockResolvedValue([{ id: "hija1" }, { id: "hija2" }]);
    await runStructured(options);
    const where = m.aggregate.mock.calls[0][0].where;
    expect(where.organizationId.in).toEqual(["org1", "hija1", "hija2"]);
  });

  it("una suborganización con padre en modo personalizado usa su clave y su tope", async () => {
    m.orgFind.mockResolvedValue(
      orgWith({ parent: parentWith({ aiMode: "custom", customKeyEnc: "PPP", aiMonthlyBudgetUsd: 5 }) }),
    );
    m.aggregate.mockResolvedValue({ _sum: { costEstimate: 5, inputTokens: 0, outputTokens: 0 } });
    await expect(runStructured(options)).rejects.toBeInstanceOf(AiMonthlyLimitError);
    expect(m.responsesCreate).not.toHaveBeenCalled();
    m.aggregate.mockResolvedValue({ _sum: { costEstimate: 1, inputTokens: 0, outputTokens: 0 } });
    await runStructured(options);
    expect(m.keysSeen).toContain("sk-own-PPP");
  });

  it("si la clave personalizada falla de forma definitiva, deja el aviso en la organización dueña", async () => {
    m.orgFind.mockResolvedValue(custom());
    m.responsesCreate.mockRejectedValue({ status: 429, code: "insufficient_quota" });
    await expect(runStructured(options)).rejects.toBeTruthy();
    expect(m.orgUpdate).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: { aiKeyAlertAt: expect.any(Date), aiKeyAlertMessage: expect.stringMatching(/saldo/i) },
    });
  });

  it("el tope diario de la plataforma no se aplica a quien usa clave personalizada", async () => {
    m.orgFind.mockResolvedValue(custom({ aiMonthlyBudgetUsd: 1000 }));
    m.aggregate.mockResolvedValue({ _sum: { costEstimate: 50, inputTokens: 0, outputTokens: 0 } });
    await runStructured(options);
    expect(m.responsesCreate).toHaveBeenCalledTimes(1);
  });
});
