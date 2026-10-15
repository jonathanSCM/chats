import { prisma } from "@/server/db/client";
import { ApiError, decodeCursor, finishPage, jsonResponse, keysetAfter, parseDate, parseLimit } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";
import { serializeMessage } from "@/server/integrations/serializers";

export const dynamic = "force-dynamic";

export const GET = integrationRoute<{ id: string }>("read", async (ctx, req, { id }) => {
  const q = new URL(req.url).searchParams;
  const limit = parseLimit(q.get("limit"));
  const after = parseDate(q.get("after"), "after");
  const cursor = decodeCursor(q.get("cursor"));

  // Una conversación de otra organización es "no existe" (404, no 403).
  const conversation = await prisma.conversation.findFirst({
    where: { id, bot: { organizationId: ctx.organizationId } },
    select: { id: true },
  });
  if (!conversation) throw new ApiError(404, "not_found", "Conversación no encontrada.");

  const rows = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      ...(after ? { createdAt: { gt: after } } : {}),
      ...keysetAfter("createdAt", cursor),
    },
    select: {
      id: true,
      conversationId: true,
      role: true,
      content: true,
      mediaType: true,
      isVoiceNote: true,
      fileName: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const page = finishPage(rows, limit, (r) => r.createdAt);
  return jsonResponse({ data: page.data.map(serializeMessage), nextCursor: page.nextCursor });
});
