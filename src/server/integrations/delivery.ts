import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { decrypt } from "@/lib/crypto";
import { prisma } from "@/server/db/client";
import type { IntegrationEvent } from "./events";

const TIMEOUT_MS = 10_000;

/** `t=<unix>,v1=<hex>` con HMAC-SHA256 de `"<t>.<cuerpo crudo>"`. Se re-firma en cada intento. */
export function signBody(body: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${nowSeconds}.${body}`).digest("hex");
  return `t=${nowSeconds},v1=${v1}`;
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  return mapped ? isPrivateIp(mapped[1]) : false;
}

/**
 * Protección SSRF: en producción solo https y nunca hacia redes privadas/loopback.
 * En desarrollo se permite http://localhost para probar contra el Jefe local.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  opts: { production?: boolean; resolve?: (host: string) => Promise<string[]> } = {},
): Promise<URL> {
  const production = opts.production ?? process.env.NODE_ENV === "production";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("La URL del webhook no es válida.");
  }
  if (url.username || url.password) throw new Error("La URL del webhook no debe llevar usuario ni clave.");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("La URL debe ser http(s).");
  if (!production) return url;

  if (url.protocol !== "https:") throw new Error("En producción la URL del webhook debe ser https.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("La URL del webhook no puede apuntar a un host interno.");
  }
  const addresses = isIP(host)
    ? [host]
    : await (opts.resolve ?? (async (h) => (await lookup(h, { all: true })).map((a) => a.address)))(host);
  if (addresses.length === 0 || addresses.some(isPrivateIp)) {
    throw new Error("La URL del webhook no puede apuntar a una red privada.");
  }
  return url;
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Un intento de entrega. No sigue redirecciones. */
export async function deliverOnce(
  webhook: { url: string; secretEncrypted: string },
  event: IntegrationEvent,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryResult> {
  try {
    const url = await assertSafeWebhookUrl(webhook.url);
    const body = JSON.stringify(event);
    const res = await fetchImpl(url.toString(), {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ProShopCRM-Webhooks/1",
        "X-ProShop-Signature": signBody(body, decrypt(webhook.secretEncrypted)),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `El destino respondió ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

const payloadSchema = z.object({
  webhookId: z.string(),
  event: z.object({
    eventId: z.string(),
    type: z.string(),
    organizationId: z.string(),
    occurredAt: z.string(),
    data: z.record(z.string(), z.unknown()),
  }),
});

/** Handler del job `integration_webhook_delivery`: lanza ante cualquier fallo para que la cola reintente. */
export async function handleIntegrationWebhookDelivery(rawPayload: unknown): Promise<void> {
  const { webhookId, event } = payloadSchema.parse(rawPayload);
  const webhook = await prisma.integrationWebhook.findUnique({
    where: { id: webhookId },
    include: { organization: { select: { jefeEnabled: true } } },
  });
  if (!webhook || !webhook.enabled || !webhook.organization.jefeEnabled) return; // se apagó o borró mientras esperaba: nada que entregar

  const result = await deliverOnce(webhook, event);
  if (result.ok) {
    await prisma.integrationWebhook.update({
      where: { id: webhook.id },
      data: { lastSuccessAt: new Date(), lastError: null },
    });
    return;
  }
  await prisma.integrationWebhook.update({
    where: { id: webhook.id },
    data: { lastFailureAt: new Date(), lastError: result.error ?? "Falló la entrega" },
  });
  throw new Error(result.error ?? "Falló la entrega del webhook");
}

/** Cuando la cola agota los reintentos deja el error visible en la pantalla. */
export async function markIntegrationDeliveryFailed(rawPayload: unknown): Promise<void> {
  const parsed = payloadSchema.safeParse(rawPayload);
  if (!parsed.success) return;
  await prisma.integrationWebhook
    .update({
      where: { id: parsed.data.webhookId },
      data: { lastFailureAt: new Date(), lastError: "Se agotaron los reintentos de entrega." },
    })
    .catch(() => {});
}
