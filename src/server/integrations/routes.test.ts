import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  membershipFind: vi.fn(),
  opportunityFind: vi.fn(),
  contactFind: vi.fn(),
  activityCreate: vi.fn(),
  activityFind: vi.fn(),
  activityUpdate: vi.fn(),
  conversationFind: vi.fn(),
  conversationMany: vi.fn(),
  auditMany: vi.fn(),
  recFind: vi.fn(),
  recCreate: vi.fn(),
  tx: vi.fn(),
  audit: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    organizationMembership: { findUnique: db.membershipFind },
    opportunity: { findFirst: db.opportunityFind },
    contact: { findFirst: db.contactFind },
    activity: { findFirst: db.activityFind, update: db.activityUpdate },
    conversation: { findFirst: db.conversationFind, findMany: db.conversationMany },
    message: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: db.auditMany },
    idempotencyRecord: { findUnique: db.recFind, create: db.recCreate },
    $transaction: db.tx,
  },
}));
vi.mock("@/server/services/audit", () => ({ audit: db.audit }));
vi.mock("@/server/integrations/events", async (orig) => ({
  ...(await orig<typeof import("./events")>()),
  emitIntegrationEvent: db.emit,
}));
// El guard se prueba aparte (auth.test.ts); acá fijamos la organización autenticada.
vi.mock("@/server/integrations/auth", () => ({
  authenticateIntegration: vi.fn(async () => ({ organizationId: "orgA", keyId: "k1", scopes: ["read", "write:activities"] })),
}));

import { GET as getMessages } from "@/app/api/integrations/v1/conversations/[id]/messages/route";
import { GET as getChanges } from "@/app/api/integrations/v1/changes/route";
import { POST as postActivity } from "@/app/api/integrations/v1/activities/route";
import { PATCH as patchActivity } from "@/app/api/integrations/v1/activities/[id]/route";

const ctx = <P>(params: P) => ({ params: Promise.resolve(params) });
const post = (body: unknown, key = "commitment:c1-abcdef") =>
  new Request("http://x/api/integrations/v1/activities", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });

const created = (over: Record<string, unknown> = {}) => ({
  id: "act1",
  type: "TASK",
  title: "Enviar cotizacion",
  description: null,
  dueAt: null,
  assignedToId: null,
  opportunityId: null,
  contactId: null,
  source: "ai",
  status: "PENDING",
  completedAt: null,
  createdAt: new Date("2026-10-15T12:00:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.recFind.mockResolvedValue(null);
  db.tx.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ activity: { create: db.activityCreate }, idempotencyRecord: { create: db.recCreate } }),
  );
  db.recCreate.mockResolvedValue({});
  db.activityCreate.mockResolvedValue(created());
});

describe("POST /activities", () => {
  it("crea con source=ai (ignora lo que mande el integrador) y emite el evento", async () => {
    const res = await postActivity(post({ type: "TASK", title: "Enviar cotizacion", source: "user" }), ctx({}));
    expect(res.status).toBe(201);
    expect(db.activityCreate.mock.calls[0][0].data).toMatchObject({ organizationId: "orgA", source: "ai" });
    expect(db.emit).toHaveBeenCalledOnce();
    expect(db.emit.mock.calls[0][0]).toMatchObject({ type: "activity.created", eventId: "act_act1", organizationId: "orgA" });
    expect(db.audit).toHaveBeenCalledOnce();
  });

  it("repetida con la misma clave y cuerpo: 200, misma tarea, sin crear ni emitir de nuevo", async () => {
    // El hash lo calcula el endpoint; lo obtenemos de la primera creación.
    await postActivity(post({ type: "TASK", title: "Enviar cotizacion" }), ctx({}));
    const stored = db.recCreate.mock.calls[0][0].data;
    vi.clearAllMocks();
    db.recFind.mockResolvedValue({ requestHash: stored.requestHash, responseBody: stored.responseBody });

    const res = await postActivity(post({ type: "TASK", title: "Enviar cotizacion" }), ctx({}));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("act1");
    expect(db.activityCreate).not.toHaveBeenCalled();
    expect(db.emit).not.toHaveBeenCalled();
  });

  it("misma clave con otro cuerpo: 409", async () => {
    await postActivity(post({ type: "TASK", title: "Enviar cotizacion" }), ctx({}));
    const stored = db.recCreate.mock.calls[0][0].data;
    db.recFind.mockResolvedValue({ requestHash: stored.requestHash, responseBody: stored.responseBody });
    const res = await postActivity(post({ type: "TASK", title: "OTRO titulo" }), ctx({}));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("idempotency_key_reuse");
  });

  it("assignedToId de otra organización: 422 y no crea nada", async () => {
    db.membershipFind.mockResolvedValue(null);
    const res = await postActivity(post({ type: "TASK", title: "x", assignedToId: "userDeOtraOrg" }), ctx({}));
    expect(res.status).toBe(422);
    expect(db.membershipFind.mock.calls[0][0].where.userId_organizationId).toEqual({ userId: "userDeOtraOrg", organizationId: "orgA" });
    expect(db.activityCreate).not.toHaveBeenCalled();
  });

  it("opportunityId ajena: 422", async () => {
    db.opportunityFind.mockResolvedValue(null);
    const res = await postActivity(post({ type: "TASK", title: "x", opportunityId: "oppAjena" }), ctx({}));
    expect(res.status).toBe(422);
    expect(db.opportunityFind.mock.calls[0][0].where).toEqual({ id: "oppAjena", organizationId: "orgA" });
  });

  it("sin Idempotency-Key: 400; cuerpo inválido: 422; formato de error {error, code}", async () => {
    const noKey = new Request("http://x", { method: "POST", body: JSON.stringify({ type: "TASK", title: "x" }) });
    const r1 = await postActivity(noKey, ctx({}));
    expect(r1.status).toBe(400);
    expect(await r1.json()).toMatchObject({ code: "invalid_idempotency_key", error: expect.any(String) });
    const r2 = await postActivity(post({ type: "TASK" }), ctx({}));
    expect(r2.status).toBe(422);
    expect(r2.headers.get("cache-control")).toBe("no-store");
  });
});

describe("PATCH /activities/{id}", () => {
  const req = (body: unknown) =>
    new Request("http://x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("tarea de otra organización: 404 (filtra por organizationId)", async () => {
    db.activityFind.mockResolvedValue(null);
    const res = await patchActivity(req({ status: "DONE" }), ctx({ id: "actAjena" }));
    expect(res.status).toBe(404);
    expect(db.activityFind.mock.calls[0][0].where).toEqual({ id: "actAjena", organizationId: "orgA" });
    expect(db.activityUpdate).not.toHaveBeenCalled();
  });

  it("DONE setea completedAt y emite activity.completed solo en la transición", async () => {
    db.activityFind.mockResolvedValue(created({ status: "PENDING" }));
    db.activityUpdate.mockResolvedValue(created({ status: "DONE", completedAt: new Date() }));
    const res = await patchActivity(req({ status: "DONE" }), ctx({ id: "act1" }));
    expect(res.status).toBe(200);
    expect(db.activityUpdate.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
    expect(db.emit.mock.calls[0][0]).toMatchObject({ type: "activity.completed", eventId: "actdone_act1" });

    vi.clearAllMocks();
    db.activityFind.mockResolvedValue(created({ status: "DONE", completedAt: new Date() }));
    db.activityUpdate.mockResolvedValue(created({ status: "DONE", completedAt: new Date() }));
    await patchActivity(req({ status: "DONE" }), ctx({ id: "act1" }));
    expect(db.emit).not.toHaveBeenCalled();
  });

  it("cuerpo vacío: 422", async () => {
    expect((await patchActivity(req({}), ctx({ id: "act1" }))).status).toBe(422);
  });
});

describe("GET /conversations/{id}/messages", () => {
  it("conversación de otra organización: 404, no 403", async () => {
    db.conversationFind.mockResolvedValue(null);
    const res = await getMessages(new Request("http://x/api"), ctx({ id: "convAjena" }));
    expect(res.status).toBe(404);
    expect(db.conversationFind.mock.calls[0][0].where).toEqual({
      id: "convAjena",
      bot: { organizationId: "orgA" },
    });
  });

  it("limit inválido: 400 con código estable", async () => {
    const res = await getMessages(new Request("http://x/api?limit=0"), ctx({ id: "c1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_limit");
  });
});

describe("GET /changes", () => {
  it("filtra por organizacion y acciones, y solo expone claves conocidas", async () => {
    db.auditMany.mockResolvedValue([
      {
        id: "a1",
        entityType: "Opportunity",
        entityId: "o1",
        action: "stage_change",
        actor: "USER",
        userId: "u1",
        before: { stage: "Nuevo", stageId: "s1", secreto: "x" },
        after: { stage: "Propuesta", stageId: "s2" },
        createdAt: new Date("2026-10-19T10:00:00Z"),
      },
    ]);
    const res = await getChanges(new Request("http://x/api/integrations/v1/changes?limit=10"), ctx({}));
    const body = await res.json();
    const where = db.auditMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe("orgA");
    expect(where.action.in).toContain("reschedule");
    expect(where.action.in).not.toContain("ai_analysis");
    expect(body.data[0]).toMatchObject({ action: "stage_change", before: { stage: "Nuevo", stageId: "s1" }, at: "2026-10-19T10:00:00.000Z" });
    expect(JSON.stringify(body)).not.toContain("secreto");
  });
});
