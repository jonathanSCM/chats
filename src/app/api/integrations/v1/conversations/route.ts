import { prisma } from "@/server/db/client";
import { decodeCursor, finishPage, iso, jsonResponse, keysetAfter, parseDate, parseLimit } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";

export const dynamic = "force-dynamic";

export const GET = integrationRoute("read", async (ctx, req) => {
  const q = new URL(req.url).searchParams;
  const limit = parseLimit(q.get("limit"));
  const since = parseDate(q.get("since"), "since");
  const cursor = decodeCursor(q.get("cursor"));

  const rows = await prisma.conversation.findMany({
    where: {
      bot: { organizationId: ctx.organizationId },
      ...(since ? { lastMessageAt: { gt: since } } : {}),
      ...keysetAfter("lastMessageAt", cursor),
    },
    select: {
      id: true,
      customerPhone: true,
      customerName: true,
      status: true,
      assignedToId: true,
      contactId: true,
      lastMessageAt: true,
    },
    orderBy: [{ lastMessageAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const page = finishPage(rows, limit, (r) => r.lastMessageAt);
  return jsonResponse({
    data: page.data.map((c) => ({
      id: c.id,
      customerPhone: c.customerPhone,
      customerName: c.customerName,
      status: c.status,
      assignedToId: c.assignedToId,
      contactId: c.contactId,
      lastMessageAt: iso(c.lastMessageAt),
    })),
    nextCursor: page.nextCursor,
  });
});
