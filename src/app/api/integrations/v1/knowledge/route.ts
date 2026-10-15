import { prisma } from "@/server/db/client";
import { jsonResponse } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";

export const dynamic = "force-dynamic";

export const GET = integrationRoute("read", async (ctx) => {
  const items = await prisma.knowledgeItem.findMany({
    where: { organizationId: ctx.organizationId, active: true },
    select: { id: true, category: true, title: true, content: true },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });
  return jsonResponse({ data: items });
});
