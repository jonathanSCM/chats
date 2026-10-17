import { createHmac, timingSafeEqual } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  webhookFind: vi.fn(),
  webhookFindMany: vi.fn(),
  webhookUpdate: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  prisma: {
    integrationWebhook: { findUnique: db.webhookFind, findMany: db.webhookFindMany, update: db.webhookUpdate },
  },
}));
vi.mock("@/server/jobs", () => ({ enqueue: db.enqueue }));

import { encrypt } from "@/lib/crypto";
import {
  assertSafeWebhookUrl,
  deliverOnce,
  handleIntegrationWebhookDelivery,
  markIntegrationDeliveryFailed,
  signBody,
} from "./delivery";
import { buildEvent, emitIntegrationEvent } from "./events";

const SECRET = "whsec_prueba";
const NOW = 1_800_000_000;

/** Misma verificación que hace el Jefe de Operaciones (src/lib/webhook-signature.ts). */
function verifyLikeTheBoss(body: string, header: string, secret: string, now: number): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const got = Buffer.from(parts.v1 ?? "", "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  db.webhookUpdate.mockResolvedValue({});
  db.enqueue.mockResolvedValue(undefined);
});

describe("firma", () => {
  it("es verificable con el algoritmo del Jefe y falla con otro secreto o cuerpo", () => {
    const body = JSON.stringify({ eventId: "e1" });
    const header = signBody(body, SECRET, NOW);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyLikeTheBoss(body, header, SECRET, NOW)).toBe(true);
    expect(verifyLikeTheBoss(body, header, "otro", NOW)).toBe(false);
    expect(verifyLikeTheBoss(body + " ", header, SECRET, NOW)).toBe(false);
    expect(verifyLikeTheBoss(body, header, SECRET, NOW + 1000)).toBe(false); // anti-replay
  });
});

describe("assertSafeWebhookUrl (SSRF)", () => {
  const prod = (resolve: (h: string) => Promise<string[]>) => ({ production: true, resolve });

  it("en producción exige https", async () => {
    await expect(assertSafeWebhookUrl("http://jefe.example.com/x", prod(async () => ["8.8.8.8"]))).rejects.toThrow(/https/);
  });
  it("rechaza localhost, hosts internos y credenciales en la URL", async () => {
    const ok = prod(async () => ["8.8.8.8"]);
    for (const u of ["https://localhost/x", "https://api.local/x", "https://svc.internal/x", "https://u:p@jefe.example.com/x"]) {
      await expect(assertSafeWebhookUrl(u, ok)).rejects.toThrow();
    }
  });
  it("rechaza IPs privadas literales y hosts que resuelven a redes privadas", async () => {
    const never = prod(async () => ["8.8.8.8"]);
    for (const u of ["https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.2/x", "https://169.254.169.254/x", "https://[::1]/x"]) {
      await expect(assertSafeWebhookUrl(u, never)).rejects.toThrow();
    }
    await expect(assertSafeWebhookUrl("https://evil.example.com/x", prod(async () => ["10.1.2.3"]))).rejects.toThrow();
    await expect(assertSafeWebhookUrl("https://mixto.example.com/x", prod(async () => ["8.8.8.8", "127.0.0.1"]))).rejects.toThrow();
  });
  it("acepta un https público", async () => {
    const u = await assertSafeWebhookUrl("https://jefe.example.com/webhooks/crm", prod(async () => ["93.184.216.34"]));
    expect(u.hostname).toBe("jefe.example.com");
  });
  it("en desarrollo permite http://localhost", async () => {
    const u = await assertSafeWebhookUrl("http://localhost:3111/webhooks/crm", { production: false });
    expect(u.port).toBe("3111");
  });
});

describe("deliverOnce", () => {
  const webhook = () => ({ url: "http://localhost:3111/webhooks/crm", secretEncrypted: encrypt(SECRET) });
  const event = buildEvent({ eventId: "msg_1", type: "message.created", organizationId: "org1", data: { text: "hola" } });

  it("2xx: ok; firma verificable sobre el cuerpo exacto; sin redirects", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const r = await deliverOnce(webhook(), event, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, status: 200 });
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("manual");
    const headers = init.headers as Record<string, string>;
    expect(verifyLikeTheBoss(String(init.body), headers["X-ProShop-Signature"], SECRET, Math.floor(Date.now() / 1000))).toBe(true);
    expect(JSON.parse(String(init.body))).toMatchObject({ eventId: "msg_1", type: "message.created", organizationId: "org1" });
  });

  it("no-2xx y errores de red devuelven ok:false (sin lanzar)", async () => {
    const f500 = vi.fn().mockResolvedValue(new Response("x", { status: 503 }));
    expect(await deliverOnce(webhook(), event, f500 as unknown as typeof fetch)).toMatchObject({ ok: false, status: 503 });
    const f301 = vi.fn().mockResolvedValue(new Response("", { status: 301 }));
    expect((await deliverOnce(webhook(), event, f301 as unknown as typeof fetch)).ok).toBe(false);
    const fnet = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await deliverOnce(webhook(), event, fnet as unknown as typeof fetch)).toMatchObject({ ok: false, error: "ECONNREFUSED" });
  });
});

describe("handleIntegrationWebhookDelivery (job)", () => {
  const payload = {
    webhookId: "w1",
    event: buildEvent({ eventId: "msg_1", type: "message.created", organizationId: "org1", data: {} }),
  };
  const row = (over: Record<string, unknown> = {}) => ({
    id: "w1",
    url: "http://localhost:3111/webhooks/crm",
    secretEncrypted: encrypt(SECRET),
    enabled: true,
    organization: { jefeEnabled: true },
    ...over,
  });

  it("webhook borrado o apagado: no entrega ni lanza", async () => {
    db.webhookFind.mockResolvedValueOnce(null);
    await expect(handleIntegrationWebhookDelivery(payload)).resolves.toBeUndefined();
    db.webhookFind.mockResolvedValueOnce(row({ enabled: false }));
    await expect(handleIntegrationWebhookDelivery(payload)).resolves.toBeUndefined();
    expect(db.webhookUpdate).not.toHaveBeenCalled();
  });

  it("si apagaron el Jefe mientras el aviso esperaba en la cola, se descarta sin enviar", async () => {
    db.webhookFind.mockResolvedValueOnce(row({ organization: { jefeEnabled: false } }));
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(handleIntegrationWebhookDelivery(payload)).resolves.toBeUndefined();
    expect(f).not.toHaveBeenCalled();
    expect(db.webhookUpdate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("éxito: marca lastSuccessAt y limpia el error", async () => {
    db.webhookFind.mockResolvedValue(row());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await handleIntegrationWebhookDelivery(payload);
    expect(db.webhookUpdate.mock.calls[0][0].data).toMatchObject({ lastError: null });
    expect(db.webhookUpdate.mock.calls[0][0].data.lastSuccessAt).toBeInstanceOf(Date);
    vi.unstubAllGlobals();
  });

  it("fallo: registra lastError y LANZA para que la cola reintente", async () => {
    db.webhookFind.mockResolvedValue(row());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x", { status: 500 })));
    await expect(handleIntegrationWebhookDelivery(payload)).rejects.toThrow(/500/);
    expect(db.webhookUpdate.mock.calls[0][0].data.lastFailureAt).toBeInstanceOf(Date);
    vi.unstubAllGlobals();
  });

  it("al agotar reintentos deja el error visible", async () => {
    await markIntegrationDeliveryFailed(payload);
    expect(db.webhookUpdate.mock.calls[0][0].data.lastError).toMatch(/reintentos/);
    await expect(markIntegrationDeliveryFailed({ basura: true })).resolves.toBeUndefined();
  });
});

describe("emitIntegrationEvent", () => {
  it("encola un job por webhook suscripto, con uniqueKey por webhook+evento", async () => {
    db.webhookFindMany.mockResolvedValue([
      { id: "w1", events: [] }, // todos
      { id: "w2", events: ["message.created"] },
      { id: "w3", events: ["activity.created"] }, // no suscripto
    ]);
    await emitIntegrationEvent({ eventId: "msg_1", type: "message.created", organizationId: "org1", data: { a: 1 } });
    expect(db.enqueue).toHaveBeenCalledTimes(2);
    const keys = db.enqueue.mock.calls.map((c) => c[0].uniqueKey);
    expect(keys).toEqual(["intg-w1-msg_1", "intg-w2-msg_1"]);
    expect(db.enqueue.mock.calls[0][0]).toMatchObject({ type: "integration_webhook_delivery", maxAttempts: 8 });
  });

  it("solo busca webhooks de organizaciones con el Jefe habilitado", async () => {
    db.webhookFindMany.mockResolvedValue([]);
    await emitIntegrationEvent({ eventId: "msg_1", type: "message.created", organizationId: "org1", data: {} });
    expect(db.webhookFindMany.mock.calls[0][0].where).toEqual({
      organizationId: "org1",
      enabled: true,
      organization: { jefeEnabled: true },
    });
  });

  it("sin webhooks no encola nada", async () => {
    db.webhookFindMany.mockResolvedValue([]);
    await emitIntegrationEvent({ eventId: "msg_1", type: "message.created", organizationId: "org1", data: {} });
    expect(db.enqueue).not.toHaveBeenCalled();
  });

  it("NUNCA lanza: un error de base no tumba la operación de origen", async () => {
    db.webhookFindMany.mockRejectedValue(new Error("db caida"));
    await expect(
      emitIntegrationEvent({ eventId: "msg_1", type: "message.created", organizationId: "org1", data: {} }),
    ).resolves.toBeUndefined();
  });
});
