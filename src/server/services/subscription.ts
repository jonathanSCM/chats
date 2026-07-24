import { prisma } from "@/server/db/client";

export interface UsageRecordLike {
  type: "CONSUMED" | "EXTRA_PURCHASE";
  quantity: number;
}

// Lógica pura, sin acceso a datos: separada para poder probarla sin mockear Prisma.
export function computeUsage(records: UsageRecordLike[], planLimit: number) {
  const consumed = records
    .filter((r) => r.type === "CONSUMED")
    .reduce((sum, r) => sum + r.quantity, 0);
  const extra = records
    .filter((r) => r.type === "EXTRA_PURCHASE")
    .reduce((sum, r) => sum + r.quantity, 0);

  return { consumed, allowed: planLimit + extra, extra };
}

export async function getUsageStatus(subscriptionId: string, planLimit: number) {
  const subscription = await prisma.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
  });

  const records = await prisma.usageRecord.findMany({
    where: {
      subscriptionId,
      createdAt: { gte: subscription.currentPeriodStart, lt: subscription.currentPeriodEnd },
    },
  });

  return computeUsage(records, planLimit);
}

export async function getOrgSubscriptionSummary(organizationId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  });

  if (!subscription) return null;

  const usage = await getUsageStatus(subscription.id, subscription.plan.conversationLimit);

  return { subscription, plan: subscription.plan, usage };
}
