import { prisma } from "@/server/db/client";
import { jsonResponse } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";

export const dynamic = "force-dynamic";

export const GET = integrationRoute("read", async (ctx) => {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { id: true, name: true, timezone: true },
  });
  return jsonResponse({ organizationId: org.id, name: org.name, timezone: org.timezone, scopes: ctx.scopes });
});
