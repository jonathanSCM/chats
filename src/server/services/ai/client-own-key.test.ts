import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  orgFind: vi.fn(),
  orgUpdate: vi.fn(),
  orgUpdateMany: vi.fn(),
  aggregate: vi.fn(),
  analysisCreate: vi.fn(),
  settingUpsert: vi.fn(),
  settingUpdateMany: vi.fn(),
  responsesCreate: vi.fn(),
  keysSeen: [] as string[],
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    organization: { findUnique: m.orgFind, update: m.orgUpdate, updateMany: m.orgUpdateMany },
    aiAnalysis: { aggregate: m.aggregate, create: m.analysisCreate },
    platformSetting: { upsert: m.settingUpsert, updateMany: m.settingUpdateMany },
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (enc: string) => `sk-own-${enc}` }));
vi.mock("openai", () => ({
  default: class FakeOpenAI {
    constructor(opts: { apiKey: string }) {
      m.keysSeen.push(opts.apiKey);
    }
    responses = { create: m.responsesCreate };
  },
}));

import { AiBudgetExceededError, AiOwnKeyError, runStructured } from "./client";

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
  aiOwnKeyEnabled: false,
  openaiKeyEnc: null,
  aiKeyAlertMessage: null,
  parent: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.keysSeen.length = 0;
  process.env.OPENAI_API_KEY = "sk-platform";
  process.env.AI_ENABLED = "true";
  m.aggregate.mockResolvedValue({ _sum: { costEstimate: 0 } });
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
    m.orgFind.mockResolvedValue(orgWith({ aiOwnKeyEnabled: true, openaiKeyEnc: "AAA" }));
    m.aggregate.mockResolvedValue({ _sum: { costEstimate: 999 } });
    await runStructured(options);
    expect(m.keysSeen).toContain("sk-own-AAA");
    expect(m.keysSeen).not.toContain("sk-platform");
    expect(m.aggregate).not.toHaveBeenCalled();
  });

  it("una suborganización usa la clave de su padre", async () => {
    m.orgFind.mockResolvedValue(
      orgWith({ parent: { id: "padre", aiOwnKeyEnabled: true, openaiKeyEnc: "PPP", aiKeyAlertMessage: null } }),
    );
    await runStructured(options);
    expect(m.keysSeen).toContain("sk-own-PPP");
  });

  it("si la clave propia falla de forma definitiva, deja el aviso para el dueño", async () => {
    m.orgFind.mockResolvedValue(orgWith({ aiOwnKeyEnabled: true, openaiKeyEnc: "AAA" }));
    m.responsesCreate.mockRejectedValue({ status: 401, message: "Incorrect API key" });
    await expect(runStructured(options)).rejects.toBeTruthy();
    expect(m.orgUpdate).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: { aiKeyAlertAt: expect.any(Date), aiKeyAlertMessage: expect.stringMatching(/clave/i) },
    });
    expect(m.settingUpsert).not.toHaveBeenCalled(); // el aviso global de la plataforma no se toca
  });

  it("un límite de velocidad pasajero no bloquea la IA del cliente", async () => {
    m.orgFind.mockResolvedValue(orgWith({ aiOwnKeyEnabled: true, openaiKeyEnc: "AAA" }));
    m.responsesCreate.mockRejectedValue({ status: 429, code: "rate_limit_exceeded", message: "slow down" });
    await expect(runStructured(options)).rejects.toBeTruthy();
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("con aviso activo se detiene y NO usa la clave de la plataforma", async () => {
    m.orgFind.mockResolvedValue(
      orgWith({ aiOwnKeyEnabled: true, openaiKeyEnc: "AAA", aiKeyAlertMessage: "Tu cuenta de OpenAI se quedó sin saldo." }),
    );
    await expect(runStructured(options)).rejects.toBeInstanceOf(AiOwnKeyError);
    await expect(runStructured(options)).rejects.toThrow(/sin saldo/);
    expect(m.responsesCreate).not.toHaveBeenCalled();
    expect(m.keysSeen).toHaveLength(0);
  });

  it("una llamada que funciona limpia el aviso viejo de la clave propia", async () => {
    m.orgFind.mockResolvedValue(orgWith({ aiOwnKeyEnabled: true, openaiKeyEnc: "AAA" }));
    await runStructured(options);
    expect(m.orgUpdateMany).toHaveBeenCalledWith({
      where: { id: "org1", aiKeyAlertAt: { not: null } },
      data: { aiKeyAlertAt: null, aiKeyAlertMessage: null },
    });
  });
});
