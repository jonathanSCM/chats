import { beforeEach, describe, expect, it, vi } from "vitest";

const day = 86_400_000;
const now = new Date("2026-10-15T12:00:00Z");

interface Pack {
  id: string;
  organizationId: string;
  credits: number;
  remaining: number;
  expiresAt: Date;
}
interface Usage {
  organizationId: string;
  credits: number;
  fromMonthly: number;
  fromPacks: number;
  feature: string;
  entityId: string | null;
}

const db = vi.hoisted(() => ({
  org: { id: "root", aiCreditsMonthly: 1000 as number | null, parent: null as null | { id: string; aiCreditsMonthly: number | null } },
  children: [] as { id: string }[],
  packs: [] as Pack[],
  usages: [] as Usage[],
}));

vi.mock("@/server/db/client", () => {
  const tx = {
    aiCreditUsage: {
      aggregate: async () => ({
        _sum: {
          credits: db.usages.reduce((s, u) => s + u.credits, 0),
          fromMonthly: db.usages.reduce((s, u) => s + u.fromMonthly, 0),
          fromPacks: db.usages.reduce((s, u) => s + u.fromPacks, 0),
        },
      }),
      create: async ({ data }: { data: Usage }) => {
        db.usages.push(data);
        return data;
      },
    },
    aiCreditPack: {
      findMany: async () => db.packs.filter((p) => p.remaining > 0 && p.expiresAt.getTime() > Date.now()),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; remaining: { gte: number } };
        data: { remaining: { decrement: number } };
      }) => {
        const p = db.packs.find((x) => x.id === where.id);
        if (!p || p.remaining < where.remaining.gte) return { count: 0 };
        p.remaining -= data.remaining.decrement;
        return { count: 1 };
      },
    },
  };
  return {
    prisma: {
      organization: { findUnique: async () => db.org, findMany: async () => db.children },
      ...tx,
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

import { AiCreditsExhaustedError, assertCreditsAvailable, chargeCredits, getOrgCredits } from "./credits";

const pack = (id: string, credits: number, remaining: number, days: number): Pack => ({
  id,
  organizationId: "root",
  credits,
  remaining,
  expiresAt: new Date(now.getTime() + days * day),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  db.org = { id: "root", aiCreditsMonthly: 1000, parent: null };
  db.children = [];
  db.packs = [];
  db.usages = [];
});

describe("getOrgCredits", () => {
  it("sin plan de créditos devuelve null (la organización se comporta como siempre)", async () => {
    db.org.aiCreditsMonthly = null;
    expect(await getOrgCredits("root")).toBeNull();
    await expect(assertCreditsAvailable("root", "seguimiento")).resolves.toBeUndefined();
  });

  it("una suborganización usa la bolsa de su organización principal", async () => {
    db.org = { id: "hija", aiCreditsMonthly: null, parent: { id: "root", aiCreditsMonthly: 500 } };
    const c = await getOrgCredits("hija");
    expect(c?.rootOrgId).toBe("root");
    expect(c?.balance.monthlyTotal).toBe(500);
  });
});

describe("chargeCredits", () => {
  it("descuenta de lo mensual y deja el registro", async () => {
    await chargeCredits({ organizationId: "root", feature: "seguimiento", credits: 3, entityId: "o1" }, now);
    expect(db.usages).toHaveLength(1);
    expect(db.usages[0]).toMatchObject({ credits: 3, fromMonthly: 3, fromPacks: 0 });
    expect((await getOrgCredits("root", now))?.balance.available).toBe(997);
  });

  it("al agotar lo mensual sigue con el paquete que vence antes", async () => {
    db.packs = [pack("tarde", 500, 500, 80), pack("pronto", 100, 100, 10)];
    await chargeCredits({ organizationId: "root", feature: "transcripcion", credits: 990 }, now);
    await chargeCredits({ organizationId: "root", feature: "transcripcion", credits: 60 }, now);
    expect(db.usages[1]).toMatchObject({ fromMonthly: 10, fromPacks: 50 });
    expect(db.packs.find((p) => p.id === "pronto")?.remaining).toBe(50);
    expect(db.packs.find((p) => p.id === "tarde")?.remaining).toBe(500);
  });

  it("agotado todo: lo manual se corta y el bot usa la reserva de emergencia hasta 300", async () => {
    await chargeCredits({ organizationId: "root", feature: "seguimiento", credits: 1000 }, now);
    await expect(assertCreditsAvailable("root", "seguimiento")).rejects.toBeInstanceOf(AiCreditsExhaustedError);
    await expect(assertCreditsAvailable("root", "bot_calificacion")).resolves.toBeUndefined();

    await chargeCredits({ organizationId: "root", feature: "bot_calificacion", credits: 299 }, now);
    const c = await getOrgCredits("root", now);
    expect(c?.overdraft).toBe(299);
    await expect(assertCreditsAvailable("root", "bot_calificacion")).resolves.toBeUndefined();

    await chargeCredits({ organizationId: "root", feature: "bot_calificacion", credits: 2 }, now);
    await expect(assertCreditsAvailable("root", "bot_calificacion")).rejects.toBeInstanceOf(AiCreditsExhaustedError);
  });

  it("no cobra nada si el monto es 0 o la organización no usa créditos", async () => {
    await chargeCredits({ organizationId: "root", feature: "seguimiento", credits: 0 }, now);
    db.org.aiCreditsMonthly = null;
    await chargeCredits({ organizationId: "root", feature: "seguimiento", credits: 5 }, now);
    expect(db.usages).toHaveLength(0);
  });
});
