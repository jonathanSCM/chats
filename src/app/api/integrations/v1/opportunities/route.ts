import { prisma } from "@/server/db/client";
import { decodeCursor, finishPage, jsonResponse, keysetAfter, parseDate, parseLimit } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";
import { serializeOpportunity } from "@/server/integrations/serializers";

export const dynamic = "force-dynamic";

export const GET = integrationRoute("read", async (ctx, req) => {
  const q = new URL(req.url).searchParams;
  const limit = parseLimit(q.get("limit"));
  const since = parseDate(q.get("updatedSince"), "updatedSince");
  const cursor = decodeCursor(q.get("cursor"));

  const rows = await prisma.opportunity.findMany({
    where: {
      organizationId: ctx.organizationId,
      archivedAt: null,
      ...(since ? { updatedAt: { gt: since } } : {}),
      ...keysetAfter("updatedAt", cursor),
    },
    select: {
      id: true,
      title: true,
      contactId: true,
      assignedToId: true,
      priority: true,
      estimatedValue: true,
      currency: true,
      nextAction: true,
      nextActionAt: true,
      updatedAt: true,
      stage: { select: { label: true } },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const page = finishPage(rows, limit, (r) => r.updatedAt);
  return jsonResponse({ data: page.data.map(serializeOpportunity), nextCursor: page.nextCursor });
});
