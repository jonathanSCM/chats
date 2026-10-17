import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db/client";
import { ApiError } from "./http";
import { hashApiKey, type IntegrationScope } from "./keys";

export interface IntegrationContext {
  organizationId: string;
  keyId: string;
  scopes: string[];
}

const LAST_USED_THROTTLE_MS = 60_000;
const WINDOW_MS = 60_000;
const LIMITS = { read: 120, write: 30 } as const;

// Ventana fija por clave, en memoria: alcanza para un solo contenedor. Si el CRM
// se escala a varias instancias hay que moverlo a Redis/Postgres.
const buckets = new Map<string, { start: number; count: number }>();

export function resetRateLimits() {
  buckets.clear();
}

function checkRateLimit(keyId: string, kind: "read" | "write", now: number) {
  const id = `${keyId}:${kind}`;
  const b = buckets.get(id);
  if (!b || now - b.start >= WINDOW_MS) {
    buckets.set(id, { start: now, count: 1 });
    return;
  }
  b.count++;
  if (b.count > LIMITS[kind]) {
    const retryAfter = Math.max(1, Math.ceil((b.start + WINDOW_MS - now) / 1000));
    throw new ApiError(429, "rate_limited", "Demasiadas solicitudes. Probá de nuevo en un momento.", {
      "Retry-After": String(retryAfter),
    });
  }
}

/**
 * Valida `Authorization: Bearer <clave>` y devuelve la organización de la clave.
 * Clave inexistente y revocada dan exactamente el mismo error (no revela cuál).
 */
export async function authenticateIntegration(
  req: Request,
  scope: IntegrationScope,
  now = Date.now(),
): Promise<IntegrationContext> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw new ApiError(401, "unauthorized", "Falta la clave de API o es inválida.");

  const hash = hashApiKey(match[1]);
  const record = await prisma.integrationKey.findUnique({
    where: { keyHash: hash },
    include: { organization: { select: { suspended: true, jefeEnabled: true } } },
  });

  // La búsqueda ya fue por hash exacto; la comparación en tiempo constante es defensa en profundidad.
  const valid =
    record && !record.revokedAt && timingSafeEqual(Buffer.from(record.keyHash, "hex"), Buffer.from(hash, "hex"));
  if (!record || !valid) throw new ApiError(401, "unauthorized", "Falta la clave de API o es inválida.");

  if (record.organization.suspended) {
    throw new ApiError(403, "organization_suspended", "La organización está suspendida.");
  }
  if (!record.organization.jefeEnabled) {
    throw new ApiError(403, "feature_disabled", "Esta organización no tiene habilitado el Jefe de Operaciones.");
  }
  if (!record.scopes.includes(scope)) {
    throw new ApiError(403, "insufficient_scope", "La clave no tiene permiso para esta operación.");
  }

  checkRateLimit(record.id, scope === "read" ? "read" : "write", now);

  // No bloquea la respuesta ni se escribe más de una vez por minuto.
  const cutoff = new Date(now - LAST_USED_THROTTLE_MS);
  void prisma.integrationKey
    .updateMany({
      where: { id: record.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: cutoff } }] },
      data: { lastUsedAt: new Date(now) },
    })
    .catch(() => {});

  return { organizationId: record.organizationId, keyId: record.id, scopes: record.scopes };
}
