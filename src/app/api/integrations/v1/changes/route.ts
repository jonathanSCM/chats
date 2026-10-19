import { prisma } from "@/server/db/client";
import { decodeCursor, finishPage, jsonResponse, keysetAfter, parseDate, parseLimit } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";
import { serializeChange, CHANGE_ACTIONS } from "@/server/integrations/serializers";

export const dynamic = "force-dynamic";

/**
 * Bitácora de cambios del CRM (cambio de etapa, responsable, fecha de reunión,
 * estado de la conversación). Solo las acciones de CHANGE_ACTIONS: el resto de
 * la auditoría (ajustes, claves, IA) no sale de la organización.
 */
export const GET = integrationRoute("read", async (ctx, req) => {
  const q = new URL(req.url).searchParams;
  const limit = parseLimit(q.get("limit"));
  const since = parseDate(q.get("since"), "since");
  const cursor = decodeCursor(q.get("cursor"));

  const rows = await prisma.auditLog.findMany({
    where: {
      organizationId: ctx.organizationId,
      action: { in: [...CHANGE_ACTIONS] },
      entityType: { in: ["Opportunity", "Meeting", "Conversation"] },
      ...(since ? { createdAt: { gt: since } } : {}),
      ...keysetAfter("createdAt", cursor),
    },
    select: { id: true, entityType: true, entityId: true, action: true, actor: true, userId: true, before: true, after: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const page = finishPage(rows, limit, (r) => r.createdAt);
  return jsonResponse({ data: page.data.map(serializeChange), nextCursor: page.nextCursor });
});
