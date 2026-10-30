import { prisma } from "@/server/db/client";
import { decodeCursor, finishPage, jsonResponse, keysetAfter, parseDate, parseLimit } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";
import { serializeMeeting } from "@/server/integrations/serializers";

export const dynamic = "force-dynamic";

// Se filtra por updatedAt: una transcripción o un resumen que llega después
// vuelve a aparecer para el integrador aunque la reunión sea vieja.
export const GET = integrationRoute("read", async (ctx, req) => {
  const q = new URL(req.url).searchParams;
  const limit = parseLimit(q.get("limit"));
  const since = parseDate(q.get("since"), "since");
  const cursor = decodeCursor(q.get("cursor"));
  // ?team=true: solo las reuniones marcadas como del equipo (lo que lee el Jefe de Operaciones).
  const onlyTeam = q.get("team") === "true";

  const rows = await prisma.meeting.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(onlyTeam ? { isTeam: true } : {}),
      ...(since ? { updatedAt: { gt: since } } : {}),
      ...keysetAfter("updatedAt", cursor),
    },
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      durationMinutes: true,
      status: true,
      opportunityId: true,
      transcript: true,
      audioTranscript: true,
      notes: true,
      aiSummary: true,
      aiSummaryData: true,
      aiSummaryAt: true,
      guestEmails: true,
      isTeam: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const page = finishPage(rows, limit, (r) => r.updatedAt);
  return jsonResponse({ data: page.data.map(serializeMeeting), nextCursor: page.nextCursor });
});
