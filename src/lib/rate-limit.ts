import { headers } from "next/headers";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Evita que el Map crezca sin límite en un proceso de larga duración.
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

/**
 * Rate limit en memoria de ventana fija, por proceso. Suficiente para un
 * despliegue de una sola instancia; si en el futuro se escala horizontalmente
 * habría que moverlo a Redis (ya hay REDIS_URL en el entorno, sin cliente
 * conectado todavía).
 */
export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

/** IP del cliente a partir de los headers reenviados por el proxy (Coolify/Traefik). */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}

export function rateLimitMessage(retryAfterSec: number): string {
  const minutes = Math.ceil(retryAfterSec / 60);
  return minutes <= 1
    ? "Demasiados intentos. Espera un minuto e intenta de nuevo."
    : `Demasiados intentos. Espera ${minutes} minutos e intenta de nuevo.`;
}
