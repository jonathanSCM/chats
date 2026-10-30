import { beforeEach, describe, expect, it, vi } from "vitest";

interface OrgRow {
  id: string;
  parentId: string | null;
  planId: string | null;
  plan: { name: string } | null;
  maxAdmins: number | null;
  maxSellers: number | null;
  canHaveSubOrgs: boolean;
  maxSubOrgs: number | null;
  canCustomizeBrand: boolean;
  aiCreditsMonthly: number | null;
  planNoticeMessage?: string | null;
  planStartedAt?: Date | null;
  planEndsAt?: Date | null;
}

const m = vi.hoisted(() => ({
  orgs: [] as OrgRow[],
  plans: {} as Record<string, Record<string, unknown>>,
  audit: vi.fn(),
}));

vi.mock("@/server/services/audit", () => ({ audit: m.audit }));
vi.mock("@/server/db/client", () => {
  const organization = {
    findMany: async ({ where }: { where: { planId: string } }) => m.orgs.filter((o) => o.planId === where.planId),
    findUnique: async ({ where }: { where: { id: string } }) => m.orgs.find((o) => o.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<OrgRow> }) => {
      const o = m.orgs.find((x) => x.id === where.id)!;
      Object.assign(o, data);
      return o;
    },
  };
  const plan = {
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      m.plans[where.id] = { ...m.plans[where.id], ...data };
      return m.plans[where.id];
    },
    findUnique: async ({ where }: { where: { id: string } }) => m.plans[where.id] ?? null,
  };
  const tx = { organization, plan };
  return { prisma: { ...tx, $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } };
});

import { assignPlanToOrg, renewPlan, setPlanEnd, updatePlanAndPropagate } from "./plans";

const org = (id: string, over: Partial<OrgRow> = {}): OrgRow => ({
  id,
  parentId: null,
  planId: "gla",
  plan: { name: "GLA" },
  maxAdmins: 1,
  maxSellers: 4,
  canHaveSubOrgs: false,
  maxSubOrgs: null,
  canCustomizeBrand: false,
  aiCreditsMonthly: 8000,
  planStartedAt: new Date("2026-10-01T00:00:00Z"),
  planEndsAt: new Date("2026-11-01T00:00:00Z"),
  ...over,
});

const values = { maxAdmins: 1, maxSellers: 4, canHaveSubOrgs: false, maxSubOrgs: null, canCustomizeBrand: false, aiCreditsMonthly: 8000 };

beforeEach(() => {
  vi.clearAllMocks();
  m.orgs = [org("a"), org("b")];
  m.plans = {
    gla: { id: "gla", name: "GLA", price: 249, currency: "PEN", ...values },
    pro: { id: "pro", name: "Pro", price: 499, currency: "PEN", ...values, maxSellers: 10, aiCreditsMonthly: 20000 },
  };
});

describe("updatePlanAndPropagate", () => {
  it("aplica el cambio a todas las organizaciones del plan y les deja un aviso", async () => {
    const r = await updatePlanAndPropagate("gla", { name: "GLA", price: 249, currency: "PEN", values: { ...values, aiCreditsMonthly: 10000 } }, "admin1");
    expect(r).toEqual({ orgsUpdated: 2, orgsNotified: 2 });
    for (const o of m.orgs) {
      expect(o.aiCreditsMonthly).toBe(10000);
      expect(o.planNoticeMessage).toContain("8.000 créditos de IA por mes → 10.000 créditos de IA por mes");
    }
    expect(m.audit).toHaveBeenCalledTimes(2);
  });

  it("a la organización a la que no le cambia nada no se le avisa", async () => {
    m.orgs = [org("a"), org("b", { aiCreditsMonthly: 10000 })];
    const r = await updatePlanAndPropagate("gla", { name: "GLA", price: 249, currency: "PEN", values: { ...values, aiCreditsMonthly: 10000 } }, "admin1");
    expect(r).toEqual({ orgsUpdated: 2, orgsNotified: 1 });
    expect(m.orgs[0].planNoticeMessage).toBeTruthy();
    expect(m.orgs[1].planNoticeMessage).toBeUndefined();
  });

  it("solo cambiar nombre o precio no avisa a nadie", async () => {
    const r = await updatePlanAndPropagate("gla", { name: "GLA Plus", price: 299, currency: "USD", values }, "admin1");
    expect(r.orgsNotified).toBe(0);
    expect(m.plans.gla).toMatchObject({ name: "GLA Plus", price: 299, currency: "USD" });
  });

  it("no toca organizaciones de otros planes", async () => {
    m.orgs = [org("a"), org("c", { planId: "pro", plan: { name: "Pro" }, aiCreditsMonthly: 20000, maxSellers: 10 })];
    await updatePlanAndPropagate("gla", { name: "GLA", price: 249, currency: "PEN", values: { ...values, maxSellers: 6 } }, "admin1");
    expect(m.orgs[0].maxSellers).toBe(6);
    expect(m.orgs[1].maxSellers).toBe(10);
  });

  it("sin suborganizaciones el tope se guarda vacío", async () => {
    await updatePlanAndPropagate("gla", { name: "GLA", price: 249, currency: "PEN", values: { ...values, canHaveSubOrgs: false, maxSubOrgs: 5 } }, "admin1");
    expect(m.orgs[0].maxSubOrgs).toBeNull();
  });
});

describe("assignPlanToOrg", () => {
  it("la primera asignación copia los valores y no manda aviso", async () => {
    m.orgs = [org("a", { planId: null, plan: null, maxSellers: 1, aiCreditsMonthly: null })];
    const r = await assignPlanToOrg("a", "gla", "admin1");
    expect(r).toEqual({ notified: false });
    expect(m.orgs[0]).toMatchObject({ planId: "gla", maxSellers: 4, aiCreditsMonthly: 8000 });
    expect(m.orgs[0].planNoticeMessage).toBeUndefined();
  });

  it("la primera asignación empieza hoy y vence en un mes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    m.orgs = [org("a", { planId: null, plan: null, planStartedAt: null, planEndsAt: null })];
    await assignPlanToOrg("a", "gla", "admin1");
    expect(m.orgs[0].planStartedAt?.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(m.orgs[0].planEndsAt?.toISOString()).toBe("2026-11-15T12:00:00.000Z");
    vi.useRealTimers();
  });

  it("cambiar de plan conserva las fechas de vigencia", async () => {
    await assignPlanToOrg("a", "pro", "admin1");
    expect(m.orgs[0].planStartedAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(m.orgs[0].planEndsAt?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("quitar el plan quita también la vigencia", async () => {
    await assignPlanToOrg("a", null, "admin1");
    expect(m.orgs[0]).toMatchObject({ planId: null, planStartedAt: null, planEndsAt: null });
  });

  it("cambiar de un plan a otro avisa al dueño", async () => {
    const r = await assignPlanToOrg("a", "pro", "admin1");
    expect(r).toEqual({ notified: true });
    expect(m.orgs[0]).toMatchObject({ planId: "pro", maxSellers: 10, aiCreditsMonthly: 20000 });
    expect(m.orgs[0].planNoticeMessage).toContain('Tu plan pasó de "GLA" a "Pro".');
  });

  it("quitar el plan deja los valores como estaban", async () => {
    await assignPlanToOrg("a", null, "admin1");
    expect(m.orgs[0]).toMatchObject({ planId: null, maxSellers: 4, aiCreditsMonthly: 8000 });
  });

  it("una suborganización no recibe plan propio", async () => {
    m.orgs = [org("h", { parentId: "a", planId: null, plan: null })];
    const r = await assignPlanToOrg("h", "gla", "admin1");
    expect(r).toHaveProperty("error");
  });

  it("un plan que no existe da error y no cambia nada", async () => {
    const r = await assignPlanToOrg("a", "nada", "admin1");
    expect(r).toHaveProperty("error");
    expect(m.orgs[0].planId).toBe("gla");
  });
});

describe("renewPlan", () => {
  const now = new Date("2026-10-20T00:00:00Z");

  it("si el plan sigue vigente suma el mes desde su vencimiento (no se pierden días pagados) y avisa al dueño", async () => {
    const r = await renewPlan("a", "admin1", 1, now);
    expect(r).toEqual({ endsAt: new Date("2026-12-01T00:00:00Z") });
    expect(m.orgs[0].planEndsAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(m.orgs[0].planNoticeMessage).toContain("se renovó");
    expect(m.orgs[0].planNoticeMessage).toContain("2026");
  });

  it("si ya venció cuenta desde hoy", async () => {
    m.orgs = [org("a", { planEndsAt: new Date("2026-09-01T00:00:00Z") })];
    const r = await renewPlan("a", "admin1", 1, now);
    expect(r).toEqual({ endsAt: new Date("2026-11-20T00:00:00Z") });
  });

  it("puede renovar varios meses", async () => {
    const r = await renewPlan("a", "admin1", 3, now);
    expect(r).toEqual({ endsAt: new Date("2027-02-01T00:00:00Z") });
  });

  it("no renueva sin plan, a una suborganización ni con meses inválidos", async () => {
    m.orgs = [org("sin", { planId: null, plan: null }), org("hija", { parentId: "a" })];
    expect(await renewPlan("sin", "admin1", 1, now)).toHaveProperty("error");
    expect(await renewPlan("hija", "admin1", 1, now)).toHaveProperty("error");
    expect(await renewPlan("hija", "admin1", 0, now)).toHaveProperty("error");
  });
});

describe("setPlanEnd", () => {
  it("fija el vencimiento a mano y lo deja en el registro", async () => {
    const end = new Date("2027-01-15T00:00:00Z");
    expect(await setPlanEnd("a", end, "admin1")).toEqual({ endsAt: end });
    expect(m.orgs[0].planEndsAt).toEqual(end);
    expect(m.audit).toHaveBeenCalled();
  });

  it("rechaza fechas inválidas y organizaciones sin plan", async () => {
    expect(await setPlanEnd("a", new Date("nada"), "admin1")).toHaveProperty("error");
    m.orgs = [org("sin", { planId: null, plan: null })];
    expect(await setPlanEnd("sin", new Date("2027-01-15T00:00:00Z"), "admin1")).toHaveProperty("error");
  });
});
