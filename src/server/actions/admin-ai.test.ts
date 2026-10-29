import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  orgFind: vi.fn(),
  orgUpdate: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({ prisma: { organization: { findUnique: m.orgFind, update: m.orgUpdate } } }));
vi.mock("@/server/auth/guards", () => ({
  requireSession: m.session,
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/server/services/audit", () => ({ audit: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/crypto", () => ({ encrypt: (k: string) => `enc(${k})` }));
vi.mock("@/server/services/ai/client", () => ({
  MODELS: { fast: () => "gpt-test" },
  openAiClientFor: () => ({ responses: { create: m.create } }),
}));

import { updateOrgAiAction } from "./admin-ai";

const KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz0123";

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

const BEFORE = { aiMode: "platform", customKeyEnc: null, customKeyLast4: null, aiMonthlyBudgetUsd: null, aiMonthlyTokenLimit: null };

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "sa1", role: "SUPERADMIN" } });
  m.orgFind.mockResolvedValue(BEFORE);
  m.orgUpdate.mockResolvedValue({});
  m.audit.mockResolvedValue(undefined);
  m.create.mockResolvedValue({});
});

describe("updateOrgAiAction", () => {
  it("solo el superadmin: el dueño de la organización no puede cambiar su modo de IA", async () => {
    m.session.mockResolvedValue({ user: { id: "u1", role: "OWNER", organizationId: "org1" } });
    await expect(updateOrgAiAction("org1", { error: null }, form({ aiMode: "own" }))).rejects.toThrow(/superadmin/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("modo plataforma: guarda el modo y deja la clave de la plataforma", async () => {
    const r = await updateOrgAiAction("org1", { error: null }, form({ aiMode: "platform" }));
    expect(r.error).toBeNull();
    expect(m.orgUpdate.mock.calls[0][0].data).toMatchObject({ aiMode: "platform", aiOwnKeyEnabled: false });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("modo propia: solo lo marca; la clave la pone la organización", async () => {
    await updateOrgAiAction("org1", { error: null }, form({ aiMode: "own" }));
    expect(m.orgUpdate.mock.calls[0][0].data).toMatchObject({ aiMode: "own", aiOwnKeyEnabled: true });
    expect(m.create).not.toHaveBeenCalled();
  });

  it("modo personalizado exige una clave", async () => {
    const r = await updateOrgAiAction("org1", { error: null }, form({ aiMode: "custom", aiMonthlyBudgetUsd: "10" }));
    expect(r.error).toMatch(/pegar la clave/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("modo personalizado: prueba la clave, la guarda cifrada y fija los topes", async () => {
    const r = await updateOrgAiAction(
      "org1",
      { error: null },
      form({ aiMode: "custom", customKey: KEY, aiMonthlyBudgetUsd: "12,50", aiMonthlyTokenLimit: "500000" }),
    );
    expect(r.error).toBeNull();
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.orgUpdate.mock.calls[0][0].data).toMatchObject({
      aiMode: "custom",
      customKeyEnc: `enc(${KEY})`,
      customKeyLast4: "0123",
      aiMonthlyBudgetUsd: 12.5,
      aiMonthlyTokenLimit: 500000,
      aiKeyAlertAt: null,
      aiKeyAlertMessage: null,
    });
    const logged = JSON.stringify(m.audit.mock.calls[0][0]);
    expect(logged).not.toContain(KEY);
  });

  it("topes vacíos significan sin tope", async () => {
    await updateOrgAiAction("org1", { error: null }, form({ aiMode: "custom", customKey: KEY }));
    expect(m.orgUpdate.mock.calls[0][0].data).toMatchObject({ aiMonthlyBudgetUsd: null, aiMonthlyTokenLimit: null });
  });

  it("conserva la clave guardada si no se pega otra", async () => {
    m.orgFind.mockResolvedValue({ ...BEFORE, aiMode: "custom", customKeyEnc: "ya-guardada", customKeyLast4: "9999" });
    const r = await updateOrgAiAction("org1", { error: null }, form({ aiMode: "custom", aiMonthlyBudgetUsd: "20" }));
    expect(r.error).toBeNull();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.orgUpdate.mock.calls[0][0].data).toMatchObject({ customKeyEnc: "ya-guardada", customKeyLast4: "9999", aiMonthlyBudgetUsd: 20 });
    // mismo modo y misma clave: no se borra un aviso que siga vigente
    expect(m.orgUpdate.mock.calls[0][0].data).not.toHaveProperty("aiKeyAlertAt");
  });

  it("no guarda una clave inválida ni sin saldo", async () => {
    m.create.mockRejectedValue({ status: 401 });
    expect((await updateOrgAiAction("org1", { error: null }, form({ aiMode: "custom", customKey: KEY }))).error).toMatch(/rechazó/i);
    m.create.mockRejectedValue({ status: 429, code: "insufficient_quota" });
    expect((await updateOrgAiAction("org1", { error: null }, form({ aiMode: "custom", customKey: KEY }))).error).toMatch(/saldo/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("rechaza topes con valores inválidos", async () => {
    const invalid: Record<string, string>[] = [
      { aiMonthlyBudgetUsd: "-5" },
      { aiMonthlyBudgetUsd: "abc" },
      { aiMonthlyTokenLimit: "1.5" },
      { aiMonthlyTokenLimit: "99999999999" },
    ];
    for (const bad of invalid) {
      const r = await updateOrgAiAction("org1", { error: null }, form({ aiMode: "custom", customKey: KEY, ...bad }));
      expect(r.error).toBeTruthy();
    }
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("cambiar de modo limpia el aviso de la clave anterior", async () => {
    m.orgFind.mockResolvedValue({ ...BEFORE, aiMode: "own" });
    await updateOrgAiAction("org1", { error: null }, form({ aiMode: "platform" }));
    expect(m.orgUpdate.mock.calls[0][0].data).toMatchObject({ aiKeyAlertAt: null, aiKeyAlertMessage: null });
  });

  it("un valor raro de modo vuelve a plataforma", async () => {
    await updateOrgAiAction("org1", { error: null }, form({ aiMode: "hackeado" }));
    expect(m.orgUpdate.mock.calls[0][0].data.aiMode).toBe("platform");
  });
});
