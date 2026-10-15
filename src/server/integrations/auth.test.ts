import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ keyFind: vi.fn(), keyUpdateMany: vi.fn() }));
vi.mock("@/server/db/client", () => ({
  prisma: { integrationKey: { findUnique: db.keyFind, updateMany: db.keyUpdateMany } },
}));

import { authenticateIntegration, resetRateLimits } from "./auth";
import { ApiError } from "./http";
import { generateApiKey } from "./keys";

const { key, keyHash } = generateApiKey();
const record = (over: Record<string, unknown> = {}) => ({
  id: "k1",
  organizationId: "org1",
  keyHash,
  scopes: ["read", "write:activities"],
  revokedAt: null,
  organization: { suspended: false },
  ...over,
});
const req = (auth?: string) => new Request("http://x/api", { headers: auth ? { authorization: auth } : {} });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ApiError ? `${e.status}:${e.code}` : "otro";
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  db.keyFind.mockResolvedValue(record());
  db.keyUpdateMany.mockResolvedValue({ count: 1 });
});

describe("authenticateIntegration", () => {
  it("clave válida devuelve la organización y busca por hash", async () => {
    const ctx = await authenticateIntegration(req(`Bearer ${key}`), "read");
    expect(ctx).toEqual({ organizationId: "org1", keyId: "k1", scopes: ["read", "write:activities"] });
    expect(db.keyFind.mock.calls[0][0].where).toEqual({ keyHash });
  });

  it("sin cabecera o mal formada: 401", async () => {
    expect(await code(authenticateIntegration(req(), "read"))).toBe("401:unauthorized");
    expect(await code(authenticateIntegration(req("Basic abc"), "read"))).toBe("401:unauthorized");
    expect(db.keyFind).not.toHaveBeenCalled();
  });

  it("inexistente y revocada dan exactamente el mismo error", async () => {
    db.keyFind.mockResolvedValueOnce(null);
    const missing = await code(authenticateIntegration(req(`Bearer ${key}`), "read"));
    db.keyFind.mockResolvedValueOnce(record({ revokedAt: new Date() }));
    const revoked = await code(authenticateIntegration(req(`Bearer ${key}`), "read"));
    expect(missing).toBe("401:unauthorized");
    expect(revoked).toBe(missing);
  });

  it("organización suspendida: 403", async () => {
    db.keyFind.mockResolvedValueOnce(record({ organization: { suspended: true } }));
    expect(await code(authenticateIntegration(req(`Bearer ${key}`), "read"))).toBe("403:organization_suspended");
  });

  it("scope insuficiente: 403", async () => {
    db.keyFind.mockResolvedValueOnce(record({ scopes: ["read"] }));
    expect(await code(authenticateIntegration(req(`Bearer ${key}`), "write:activities"))).toBe("403:insufficient_scope");
  });

  it("lastUsedAt se actualiza con condición de 1 vez por minuto", async () => {
    await authenticateIntegration(req(`Bearer ${key}`), "read", 1_000_000);
    const arg = db.keyUpdateMany.mock.calls[0][0];
    expect(arg.where.id).toBe("k1");
    expect(arg.where.OR).toEqual([{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(1_000_000 - 60_000) } }]);
  });

  it("rate limit de lectura: 120 por minuto, 429 con Retry-After, y la ventana se renueva", async () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 120; i++) await authenticateIntegration(req(`Bearer ${key}`), "read", t0);
    let err: ApiError | null = null;
    try {
      await authenticateIntegration(req(`Bearer ${key}`), "read", t0 + 1000);
    } catch (e) {
      err = e as ApiError;
    }
    expect(err?.status).toBe(429);
    expect(Number(err?.headers["Retry-After"])).toBeGreaterThan(0);
    await expect(authenticateIntegration(req(`Bearer ${key}`), "read", t0 + 61_000)).resolves.toBeTruthy();
  });

  it("escritura tiene su propio límite más bajo (30/min)", async () => {
    const t0 = 9_000_000;
    for (let i = 0; i < 30; i++) await authenticateIntegration(req(`Bearer ${key}`), "write:activities", t0);
    expect(await code(authenticateIntegration(req(`Bearer ${key}`), "write:activities", t0))).toBe("429:rate_limited");
    // La lectura no se ve afectada por el balde de escritura.
    await expect(authenticateIntegration(req(`Bearer ${key}`), "read", t0)).resolves.toBeTruthy();
  });
});
