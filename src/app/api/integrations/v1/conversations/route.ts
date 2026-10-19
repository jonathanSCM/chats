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
      botMemory: true,
      lastMessageAt: true,
    },
    orderBy: [{ lastMessageAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const page = finishPage(rows, limit, (r) => r.lastMessageAt);

  // Oportunidad vigente de cada contacto (la mas recientemente actualizada, sin archivar): el
  // integrador la usa para vincular lo que detecte en la conversacion con el caso.
  const contactIds = [...new Set(page.data.map((c) => c.contactId).filter((id): id is string => Boolean(id)))];
  const opportunityByContact = new Map<string, string>();
  if (contactIds.length > 0) {
    const opps = await prisma.opportunity.findMany({
      where: { organizationId: ctx.organizationId, contactId: { in: contactIds }, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, contactId: true },
    });
    for (const o of opps) if (!opportunityByContact.has(o.contactId)) opportunityByContact.set(o.contactId, o.id);
  }

  return jsonResponse({
    data: page.data.map((c) => ({
      id: c.id,
      customerPhone: c.customerPhone,
      customerName: c.customerName,
      status: c.status,
      assignedToId: c.assignedToId,
      contactId: c.contactId,
      opportunityId: c.contactId ? (opportunityByContact.get(c.contactId) ?? null) : null,
      // Resumen acumulado que el bot de calificacion mantiene (null si la conversacion no paso por el bot).
      memory: c.botMemory,
      lastMessageAt: iso(c.lastMessageAt),
    })),
    nextCursor: page.nextCursor,
  });
});
