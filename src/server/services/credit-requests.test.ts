import { beforeEach, describe, expect, it, vi } from "vitest";

interface Req {
  id: string;
  organizationId: string;
  requestedById: string | null;
  kind: string;
  credits: number | null;
  note: string | null;
  status: string;
  resolvedAt: Date | null;
  resolvedById: string | null;
  resolvedNote: string | null;
  createdAt: Date;
}

const m = vi.hoisted(() => ({
  requests: [] as Req[],
  orgs: {} as Record<string, { id: string; name: string; aiCreditsMonthly: number | null; parent: { id: string; name: string; aiCreditsMonthly: number | null } | null }>,
  audit: vi.fn(),
  addPack: vi.fn(),
  renew: vi.fn(),
}));

vi.mock("@/server/services/audit", () => ({ audit: m.audit }));
vi.mock("@/server/services/ai/credits", () => ({ addCreditPack: m.addPack }));
vi.mock("@/server/services/plans", () => ({ renewPlan: m.renew }));
vi.mock("@/server/db/client", () => ({
  prisma: {
    organization: { findUnique: async ({ where }: { where: { id: string } }) => m.orgs[where.id] ?? null },
    user: { findMany: async () => [] },
    creditRequest: {
      count: async ({ where }: { where: { organizationId?: string; status?: string } }) =>
        m.requests.filter((r) => (!where.organizationId || r.organizationId === where.organizationId) && (!where.status || r.status === where.status)).length,
      create: async ({ data }: { data: Partial<Req> }) => {
        const r = { id: `r${m.requests.length + 1}`, status: "PENDING", resolvedAt: null, resolvedById: null, resolvedNote: null, createdAt: new Date(), ...data } as Req;
        m.requests.push(r);
        return r;
      },
      findUnique: async ({ where }: { where: { id: string } }) => m.requests.find((r) => r.id === where.id) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<Req> }) => {
        const r = m.requests.find((x) => x.id === where.id && x.status === where.status);
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
    },
  },
}));

import { approveRequest, createRequest, rejectRequest, MAX_PENDING_PER_ORG } from "./credit-requests";

beforeEach(() => {
  vi.clearAllMocks();
  m.requests = [];
  m.orgs = {
    root: { id: "root", name: "Américas", aiCreditsMonthly: 8000, parent: null },
    hija: { id: "hija", name: "Sucursal", aiCreditsMonthly: null, parent: { id: "root", name: "Américas", aiCreditsMonthly: 8000 } },
    sinbolsa: { id: "sinbolsa", name: "Sin bolsa", aiCreditsMonthly: null, parent: null },
  };
  m.addPack.mockResolvedValue({});
  m.renew.mockResolvedValue({ endsAt: new Date("2026-12-01T00:00:00Z") });
});

describe("createRequest", () => {
  it("crea una solicitud de créditos pendiente", async () => {
    const r = await createRequest({ organizationId: "root", userId: "u1", kind: "CREDITS", credits: 5000, note: "  urgente  " });
    expect(r).toHaveProperty("id");
    expect(m.requests[0]).toMatchObject({ status: "PENDING", kind: "CREDITS", credits: 5000, note: "urgente" });
  });

  it("valida la cantidad", async () => {
    expect(await createRequest({ organizationId: "root", userId: "u1", kind: "CREDITS", credits: 10 })).toHaveProperty("error");
    expect(await createRequest({ organizationId: "root", userId: "u1", kind: "CREDITS", credits: 5_000_000 })).toHaveProperty("error");
    expect(await createRequest({ organizationId: "root", userId: "u1", kind: "CREDITS", credits: null })).toHaveProperty("error");
    expect(m.requests).toHaveLength(0);
  });

  it("la renovación no pide cantidad", async () => {
    const r = await createRequest({ organizationId: "root", userId: "u1", kind: "RENEWAL" });
    expect(r).toHaveProperty("id");
    expect(m.requests[0].credits).toBeNull();
  });

  it("limita las solicitudes pendientes por organización", async () => {
    for (let i = 0; i < MAX_PENDING_PER_ORG; i++) {
      await createRequest({ organizationId: "root", userId: "u1", kind: "CREDITS", credits: 1000 });
    }
    expect(await createRequest({ organizationId: "root", userId: "u1", kind: "CREDITS", credits: 1000 })).toHaveProperty("error");
  });
});

describe("approveRequest", () => {
  it("carga el paquete en la organización dueña de la bolsa y marca la solicitud atendida", async () => {
    await createRequest({ organizationId: "root", userId: "u1", kind: "CREDITS", credits: 5000 });
    const r = await approveRequest("r1", "admin1");
    expect(r).toHaveProperty("message");
    expect(m.addPack).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "root", credits: 5000, createdById: "admin1" }));
    expect(m.requests[0]).toMatchObject({ status: "APPROVED", resolvedById: "admin1" });
  });

  it("una suborganización pide a nombre de su organización principal", async () => {
    await createRequest({ organizationId: "hija", userId: "u1", kind: "CREDITS", credits: 2000 });
    await approveRequest("r1", "admin1");
    expect(m.addPack).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "root", credits: 2000 }));
  });

  it("no carga créditos a una organización sin bolsa mensual", async () => {
    await createRequest({ organizationId: "sinbolsa", userId: "u1", kind: "CREDITS", credits: 2000 });
    const r = await approveRequest("r1", "admin1");
    expect(r).toHaveProperty("error");
    expect(m.addPack).not.toHaveBeenCalled();
    expect(m.requests[0].status).toBe("PENDING");
  });

  it("una renovación renueva el plan un mes", async () => {
    await createRequest({ organizationId: "root", userId: "u1", kind: "RENEWAL" });
    const r = await approveRequest("r1", "admin1");
    expect(r).toHaveProperty("message");
    expect(m.renew).toHaveBeenCalledWith("root", "admin1", 1, expect.any(Date));
    expect(m.requests[0].status).toBe("APPROVED");
  });

  it("si la renovación falla la solicitud sigue pendiente", async () => {
    m.renew.mockResolvedValue({ error: "no tiene plan" });
    await createRequest({ organizationId: "root", userId: "u1", kind: "RENEWAL" });
    expect(await approveRequest("r1", "admin1")).toEqual({ error: "no tiene plan" });
    expect(m.requests[0].status).toBe("PENDING");
  });

  it("no se aprueba dos veces", async () => {
    await createRequest({ organizationId: "root", userId: "u1", kind: "CREDITS", credits: 1000 });
    await approveRequest("r1", "admin1");
    expect(await approveRequest("r1", "admin1")).toHaveProperty("error");
    expect(m.addPack).toHaveBeenCalledTimes(1);
  });
});

describe("rejectRequest", () => {
  it("rechaza con una nota y no carga nada", async () => {
    await createRequest({ organizationId: "root", userId: "u1", kind: "CREDITS", credits: 1000 });
    expect(await rejectRequest("r1", "admin1", "Sin pago")).toEqual({ ok: true });
    expect(m.requests[0]).toMatchObject({ status: "REJECTED", resolvedNote: "Sin pago" });
    expect(m.addPack).not.toHaveBeenCalled();
    expect(await rejectRequest("r1", "admin1")).toHaveProperty("error");
  });
});
