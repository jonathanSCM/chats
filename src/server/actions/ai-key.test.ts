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
vi.mock("@/server/auth/guards", () => ({ requireSession: m.session }));
vi.mock("@/server/services/audit", () => ({ audit: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/crypto", () => ({ encrypt: (k: string) => `enc(${k})` }));
vi.mock("@/server/services/ai/client", () => ({
  MODELS: { fast: () => "gpt-test" },
  openAiClientFor: () => ({ responses: { create: m.create } }),
}));

import { removeOpenAiKeyAction, saveOpenAiKeyAction } from "./ai-key";

const KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz0123";

function form(key: string): FormData {
  const f = new FormData();
  f.set("openaiKey", key);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "u1", role: "OWNER", organizationId: "org1" } });
  m.orgFind.mockResolvedValue({ aiMode: "own", openaiKeyLast4: null });
  m.orgUpdate.mockResolvedValue({});
  m.audit.mockResolvedValue(undefined);
  m.create.mockResolvedValue({});
});

describe("saveOpenAiKeyAction", () => {
  it("solo el dueño", async () => {
    m.session.mockResolvedValue({ user: { id: "u2", role: "MEMBER", organizationId: "org1" } });
    expect((await saveOpenAiKeyAction({ error: null }, form(KEY))).error).toMatch(/dueño/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("solo si el superadmin habilitó la opción en el plan", async () => {
    m.orgFind.mockResolvedValue({ aiMode: "platform", openaiKeyLast4: null });
    expect((await saveOpenAiKeyAction({ error: null }, form(KEY))).error).toMatch(/plan/i);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("rechaza lo que no parece una clave, sin llamar a OpenAI", async () => {
    expect((await saveOpenAiKeyAction({ error: null }, form("hola"))).error).toMatch(/formato/i);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("prueba la clave y la guarda cifrada, con solo los últimos 4 a la vista", async () => {
    const r = await saveOpenAiKeyAction({ error: null }, form(KEY));
    expect(r.error).toBeNull();
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.orgUpdate).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: { openaiKeyEnc: `enc(${KEY})`, openaiKeyLast4: "0123", aiKeyAlertAt: null, aiKeyAlertMessage: null },
    });
    const logged = JSON.stringify(m.audit.mock.calls[0][0]);
    expect(logged).not.toContain(KEY); // la clave nunca va a la auditoría
    expect(logged).toContain("0123");
  });

  it("no guarda una clave inválida y explica por qué", async () => {
    m.create.mockRejectedValue({ status: 401, message: "Incorrect API key" });
    const r = await saveOpenAiKeyAction({ error: null }, form(KEY));
    expect(r.error).toMatch(/rechazó tu clave/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("una clave sin saldo tampoco se guarda", async () => {
    m.create.mockRejectedValue({ status: 429, code: "insufficient_quota" });
    expect((await saveOpenAiKeyAction({ error: null }, form(KEY))).error).toMatch(/saldo/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("un fallo pasajero de red avisa sin culpar a la clave", async () => {
    m.create.mockRejectedValue(new Error("fetch failed"));
    expect((await saveOpenAiKeyAction({ error: null }, form(KEY))).error).toMatch(/en este momento/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });
});

describe("removeOpenAiKeyAction", () => {
  it("borra la clave y el aviso", async () => {
    const r = await removeOpenAiKeyAction();
    expect(r.error).toBeNull();
    expect(m.orgUpdate).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: { openaiKeyEnc: null, openaiKeyLast4: null, aiKeyAlertAt: null, aiKeyAlertMessage: null },
    });
  });
});
