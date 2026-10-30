import { prisma } from "@/server/db/client";
import { monthStartUtc, nextMonthStartUtc } from "@/lib/ai-limit";
import {
  AUTOMATIC_FEATURES,
  canSpend,
  computeBalance,
  creditLevel,
  creditNoticeText,
  splitCharge,
  PACK_VALID_DAYS,
  type CreditBalance,
  type CreditLevel,
} from "@/lib/ai-credits";

/** Se acabaron los créditos de IA de la organización: se omite lo que gasta IA sin llenar la cola de reintentos. */
export class AiCreditsExhaustedError extends Error {
  constructor(message = "Se acabaron los créditos de IA de la organización") {
    super(message);
    this.name = "AiCreditsExhaustedError";
  }
}

export interface OrgCredits {
  /** La organización dueña de la bolsa (la principal, si es una suborganización). */
  rootOrgId: string;
  balance: CreditBalance;
  level: CreditLevel;
  /** Créditos gastados por encima del saldo este mes (uso de la reserva de emergencia). */
  overdraft: number;
  /** Cuándo se renueva la bolsa mensual. */
  renewsAt: Date;
}

/** Una suborganización gasta de la bolsa de su organización principal. */
async function resolveRoot(organizationId: string): Promise<{ rootOrgId: string; monthly: number | null } | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, aiCreditsMonthly: true, parent: { select: { id: true, aiCreditsMonthly: true } } },
  });
  if (!org) return null;
  const root = org.parent ?? org;
  return { rootOrgId: root.id, monthly: root.aiCreditsMonthly };
}

async function familyIds(rootOrgId: string): Promise<string[]> {
  const children = await prisma.organization.findMany({ where: { parentId: rootOrgId }, select: { id: true } });
  return [rootOrgId, ...children.map((c) => c.id)];
}

/** Saldo de créditos de una organización; null si no usa créditos (sin plan de créditos). */
export async function getOrgCredits(organizationId: string, now = new Date()): Promise<OrgCredits | null> {
  const root = await resolveRoot(organizationId);
  if (!root || root.monthly === null) return null;

  const ids = await familyIds(root.rootOrgId);
  const [usage, packs] = await Promise.all([
    prisma.aiCreditUsage.aggregate({
      where: { organizationId: { in: ids }, createdAt: { gte: monthStartUtc(now) } },
      _sum: { credits: true, fromMonthly: true, fromPacks: true },
    }),
    prisma.aiCreditPack.findMany({
      where: { organizationId: root.rootOrgId, remaining: { gt: 0 }, expiresAt: { gt: now } },
      select: { id: true, credits: true, remaining: true, expiresAt: true },
    }),
  ]);

  const total = usage._sum.credits ?? 0;
  const fromMonthly = usage._sum.fromMonthly ?? 0;
  const fromPacks = usage._sum.fromPacks ?? 0;
  const balance = computeBalance({ monthlyTotal: root.monthly, monthlyUsed: fromMonthly, packs, now });
  return {
    rootOrgId: root.rootOrgId,
    balance,
    level: creditLevel(balance),
    overdraft: Math.max(0, total - fromMonthly - fromPacks),
    renewsAt: nextMonthStartUtc(now),
  };
}

/** Antes de gastar IA: si no quedan créditos (y no es un proceso automático con reserva) corta con AiCreditsExhaustedError. */
export async function assertCreditsAvailable(organizationId: string, feature: string): Promise<void> {
  const credits = await getOrgCredits(organizationId);
  if (!credits) return;
  const ok = canSpend(credits.balance, { automatic: AUTOMATIC_FEATURES.has(feature), overdraft: credits.overdraft });
  if (!ok) throw new AiCreditsExhaustedError(creditNoticeText("exhausted", credits.balance) ?? undefined);
}

export interface ChargeInput {
  organizationId: string;
  userId?: string | null;
  feature: string;
  credits: number;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  audioMinutes?: number;
  costUsd?: number;
  entityId?: string | null;
}

/** Descuenta créditos (primero lo mensual, después los paquetes que vencen antes) y deja el registro. */
export async function chargeCredits(input: ChargeInput, now = new Date()): Promise<void> {
  if (input.credits <= 0) return;
  const root = await resolveRoot(input.organizationId);
  if (!root || root.monthly === null) return;
  const monthly = root.monthly;
  const ids = await familyIds(root.rootOrgId);

  await prisma.$transaction(async (tx) => {
    const [used, packs] = await Promise.all([
      tx.aiCreditUsage.aggregate({
        where: { organizationId: { in: ids }, createdAt: { gte: monthStartUtc(now) } },
        _sum: { fromMonthly: true },
      }),
      tx.aiCreditPack.findMany({
        where: { organizationId: root.rootOrgId, remaining: { gt: 0 }, expiresAt: { gt: now } },
        select: { id: true, remaining: true, expiresAt: true },
      }),
    ]);
    const monthlyRemaining = Math.max(0, monthly - (used._sum.fromMonthly ?? 0));
    const split = splitCharge(input.credits, monthlyRemaining, packs, now);

    let fromPacks = 0;
    for (const part of split.fromPacks) {
      // Condicional: si otro cobro simultáneo ya se llevó ese saldo, no se deja el paquete en negativo.
      const r = await tx.aiCreditPack.updateMany({
        where: { id: part.id, remaining: { gte: part.amount } },
        data: { remaining: { decrement: part.amount } },
      });
      if (r.count > 0) fromPacks += part.amount;
    }

    await tx.aiCreditUsage.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        feature: input.feature,
        model: input.model ?? null,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        audioMinutes: input.audioMinutes ?? 0,
        costUsd: input.costUsd ?? 0,
        credits: input.credits,
        fromMonthly: split.fromMonthly,
        fromPacks,
        entityId: input.entityId ?? null,
      },
    });
  });
}

/** Recarga manual del superadmin: un paquete que dura 90 días. */
export async function addCreditPack(input: {
  organizationId: string;
  credits: number;
  days?: number;
  note?: string | null;
  createdById?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.days ?? PACK_VALID_DAYS) * 86_400_000);
  return prisma.aiCreditPack.create({
    data: {
      organizationId: input.organizationId,
      credits: input.credits,
      remaining: input.credits,
      expiresAt,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
  });
}

export interface CreditUsageSummary {
  byFeature: { feature: string; credits: number; calls: number }[];
  byUser: { userId: string | null; name: string; credits: number }[];
  recent: {
    id: string;
    createdAt: Date;
    feature: string;
    credits: number;
    userName: string | null;
    organizationName: string;
    model: string | null;
    costUsd: number;
    audioMinutes: number;
  }[];
  realCostUsd: number;
}

/** Resumen del consumo del mes: por función, por usuario y las últimas operaciones (con el costo real de la API). */
export async function getCreditUsageSummary(rootOrgId: string, now = new Date(), recentLimit = 25): Promise<CreditUsageSummary> {
  const ids = await familyIds(rootOrgId);
  const where = { organizationId: { in: ids }, createdAt: { gte: monthStartUtc(now) } };
  const [byFeature, byUser, recent, cost] = await Promise.all([
    prisma.aiCreditUsage.groupBy({ by: ["feature"], where, _sum: { credits: true }, _count: { _all: true } }),
    prisma.aiCreditUsage.groupBy({ by: ["userId"], where, _sum: { credits: true } }),
    prisma.aiCreditUsage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: recentLimit,
      include: { organization: { select: { name: true } } },
    }),
    prisma.aiCreditUsage.aggregate({ where, _sum: { costUsd: true } }),
  ]);

  const userIds = [...new Set([...byUser.map((u) => u.userId), ...recent.map((r) => r.userId)].filter((x): x is string => Boolean(x)))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const nameOf = (id: string | null) => {
    if (!id) return null;
    const u = users.find((x) => x.id === id);
    return u ? u.name || u.email : "Usuario eliminado";
  };

  return {
    byFeature: byFeature
      .map((f) => ({ feature: f.feature, credits: f._sum.credits ?? 0, calls: f._count._all }))
      .sort((a, b) => b.credits - a.credits),
    byUser: byUser
      .map((u) => ({ userId: u.userId, name: nameOf(u.userId) ?? "Automático (bot y reuniones)", credits: u._sum.credits ?? 0 }))
      .sort((a, b) => b.credits - a.credits),
    recent: recent.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      feature: r.feature,
      credits: r.credits,
      userName: nameOf(r.userId),
      organizationName: r.organization.name,
      model: r.model,
      costUsd: Number(r.costUsd),
      audioMinutes: r.audioMinutes,
    })),
    realCostUsd: Number(cost._sum.costUsd ?? 0),
  };
}

/** Paquetes comprados de una organización (vigentes, agotados y vencidos) para mostrar el historial. */
export async function listCreditPacks(rootOrgId: string, now = new Date()) {
  const packs = await prisma.aiCreditPack.findMany({ where: { organizationId: rootOrgId }, orderBy: { createdAt: "desc" }, take: 20 });
  return packs.map((p) => ({ ...p, expired: p.expiresAt.getTime() <= now.getTime() }));
}
