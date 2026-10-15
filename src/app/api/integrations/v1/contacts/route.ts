import { prisma } from "@/server/db/client";
import { decodeCursor, finishPage, jsonResponse, keysetAfter, parseDate, parseLimit } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";

export const dynamic = "force-dynamic";

export const GET = integrationRoute("read", async (ctx, req) => {
  const q = new URL(req.url).searchParams;
  const limit = parseLimit(q.get("limit"));
  const since = parseDate(q.get("since"), "since");
  const cursor = decodeCursor(q.get("cursor"));

  const rows = await prisma.contact.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(since ? { updatedAt: { gt: since } } : {}),
      ...keysetAfter("updatedAt", cursor),
    },
    select: {
      id: true,
      fullName: true,
      phone: true,
      email: true,
      assignedToId: true,
      updatedAt: true,
      company: { select: { name: true } },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const page = finishPage(rows, limit, (r) => r.updatedAt);
  return jsonResponse({
    data: page.data.map((c) => ({
      id: c.id,
      fullName: c.fullName ?? c.phone,
      phone: c.phone,
      email: c.email,
      companyName: c.company?.name ?? null,
      assignedToId: c.assignedToId,
    })),
    nextCursor: page.nextCursor,
  });
});
