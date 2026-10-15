import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const db = vi.hoisted(() => ({ recFind: vi.fn(), recCreate: vi.fn(), tx: vi.fn() }));
vi.mock("@/server/db/client", () => ({
  prisma: { idempotencyRecord: { findUnique: db.recFind, create: db.recCreate }, $transaction: db.tx },
}));

import { ApiError } from "./http";
import { hashRequest, readIdempotencyKey, runIdempotent } from "./idempotency";

const BODY = { title: "Enviar cotizacion", type: "TASK" };
const base = { organizationId: "org1", key: "commitment:c1-abcdef", method: "POST", path: "/activities", body: BODY };

beforeEach(() => {
  vi.clearAllMocks();
  db.recFind.mockResolvedValue(null);
  // La transacción ejecuta el callback con un "tx" que expone idempotencyRecord.create.
  db.tx.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({ idempotencyRecord: { create: db.recCreate } }));
  db.recCreate.mockResolvedValue({});
});

describe("readIdempotencyKey", () => {
  const r = (v?: string) => new Request("http://x", { headers: v ? { "idempotency-key": v } : {} });
  it("acepta 8 a 128 caracteres", () => {
    expect(readIdempotencyKey(r("commitment:abc"))).toBe("commitment:abc");
  });
  it("rechaza ausente, corta o larga", () => {
    for (const bad of [undefined, "corta", "x".repeat(129)]) {
      expect(() => readIdempotencyKey(r(bad))).toThrow(ApiError);
    }
  });
});

describe("runIdempotent", () => {
  it("primera vez: ejecuta y guarda la respuesta en la misma transacción", async () => {
    const execute = vi.fn().mockResolvedValue({ status: 201, body: { id: "a1" } });
    const out = await runIdempotent({ ...base, execute });
    expect(out).toEqual({ status: 201, body: { id: "a1" }, replay: false });
    expect(execute).toHaveBeenCalledOnce();
    expect(db.recCreate.mock.calls[0][0].data).toMatchObject({
      organizationId: "org1",
      idempotencyKey: base.key,
      requestHash: hashRequest(BODY),
      responseStatus: 201,
      responseBody: { id: "a1" },
    });
  });

  it("misma clave y mismo cuerpo: devuelve lo guardado (200) sin ejecutar", async () => {
    db.recFind.mockResolvedValue({ requestHash: hashRequest(BODY), responseBody: { id: "a1" } });
    const execute = vi.fn();
    const out = await runIdempotent({ ...base, execute });
    expect(out).toEqual({ status: 200, body: { id: "a1" }, replay: true });
    expect(execute).not.toHaveBeenCalled();
    expect(db.tx).not.toHaveBeenCalled();
  });

  it("misma clave con otro cuerpo: 409 idempotency_key_reuse", async () => {
    db.recFind.mockResolvedValue({ requestHash: hashRequest({ other: true }), responseBody: {} });
    await expect(runIdempotent({ ...base, execute: vi.fn() })).rejects.toMatchObject({
      status: 409,
      code: "idempotency_key_reuse",
    });
  });

  it("carrera: el perdedor (P2002) relee el registro ganador y no duplica", async () => {
    db.recFind
      .mockResolvedValueOnce(null) // chequeo inicial
      .mockResolvedValueOnce({ requestHash: hashRequest(BODY), responseBody: { id: "ganador" } }); // tras el conflicto
    db.tx.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "7" }),
    );
    const out = await runIdempotent({ ...base, execute: vi.fn() });
    expect(out).toEqual({ status: 200, body: { id: "ganador" }, replay: true });
  });

  it("un error del execute se propaga y no deja registro", async () => {
    db.tx.mockImplementationOnce(async (cb: (tx: unknown) => unknown) => cb({ idempotencyRecord: { create: db.recCreate } }));
    await expect(
      runIdempotent({ ...base, execute: vi.fn().mockRejectedValue(new ApiError(422, "validation_error", "x")) }),
    ).rejects.toMatchObject({ status: 422 });
    expect(db.recCreate).not.toHaveBeenCalled();
  });
});
