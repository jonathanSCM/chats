import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { ApiError } from "./http";

export interface IdempotentOutcome {
  status: number;
  body: unknown;
}

/** JSON canónico (claves ordenadas) para que el mismo cuerpo dé siempre el mismo hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const hashRequest = (body: unknown) => createHash("sha256").update(canonical(body)).digest("hex");

export function readIdempotencyKey(req: Request): string {
  const key = req.headers.get("idempotency-key")?.trim() ?? "";
  if (key.length < 8 || key.length > 128) {
    throw new ApiError(400, "invalid_idempotency_key", "Falta la cabecera Idempotency-Key (8 a 128 caracteres).");
  }
  return key;
}

/**
 * Ejecuta una escritura una sola vez por (organización, Idempotency-Key).
 *  - Primera vez: corre `execute` y guarda la respuesta en la MISMA transacción.
 *  - Repetida con el mismo cuerpo: devuelve la respuesta guardada, `replay: true`, sin ejecutar nada.
 *  - Repetida con otro cuerpo: 409 `idempotency_key_reuse`.
 * Dos pedidos simultáneos: gana el unique de la base y el perdedor relee el registro ganador.
 */
export async function runIdempotent(opts: {
  organizationId: string;
  key: string;
  method: string;
  path: string;
  body: unknown;
  execute: (tx: Prisma.TransactionClient) => Promise<IdempotentOutcome>;
}): Promise<IdempotentOutcome & { replay: boolean }> {
  const requestHash = hashRequest(opts.body);
  const where = { organizationId_idempotencyKey: { organizationId: opts.organizationId, idempotencyKey: opts.key } };

  const replay = async () => {
    const found = await prisma.idempotencyRecord.findUnique({ where });
    if (!found) return null;
    if (found.requestHash !== requestHash) {
      throw new ApiError(409, "idempotency_key_reuse", "Esa Idempotency-Key ya se usó con otro cuerpo.");
    }
    return { status: 200, body: found.responseBody as unknown, replay: true as const };
  };

  const existing = await replay();
  if (existing) return existing;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const result = await opts.execute(tx);
      await tx.idempotencyRecord.create({
        data: {
          organizationId: opts.organizationId,
          idempotencyKey: opts.key,
          method: opts.method,
          path: opts.path,
          requestHash,
          responseStatus: result.status,
          responseBody: result.body as Prisma.InputJsonValue,
        },
      });
      return result;
    });
    return { ...outcome, replay: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await replay();
      if (raced) return raced;
    }
    throw e;
  }
}
