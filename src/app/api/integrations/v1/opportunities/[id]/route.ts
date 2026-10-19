import { prisma } from "@/server/db/client";
import { ApiError, jsonResponse } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";
import { serializeOpportunity } from "@/server/integrations/serializers";

export const dynamic = "force-dynamic";

export const GET = integrationRoute<{ id: string }>("read", async (ctx, _req, { id }) => {
  const o = await prisma.opportunity.findFirst({
    where: { id, organizationId: ctx.organizationId },
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
      aiMemory: true,
      needSummary: true,
      updatedAt: true,
      stage: { select: { label: true } },
    },
  });
  if (!o) throw new ApiError(404, "not_found", "Oportunidad no encontrada.");
  return jsonResponse(serializeOpportunity(o));
});
