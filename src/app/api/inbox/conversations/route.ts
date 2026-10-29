import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Un vendedor (MEMBER) solo ve lo suyo + lo sin asignar, y solo dentro de
  // las cuentas de WhatsApp que tiene asignadas (BotMember). OWNER/SUPERADMIN
  // ven todo. El parámetro ?botId= filtra además a una sola cuenta (para la
  // navegación por cuenta en el lateral) sin saltarse esa restricción.
  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  const userId = session.user.id;
  const url = new URL(request.url);
  const requestedBotId = url.searchParams.get("botId");
  // "active" (default): ni archivada (status CLOSED) ni bloqueada.
  const view = url.searchParams.get("view") === "archived" || url.searchParams.get("view") === "blocked"
    ? (url.searchParams.get("view") as "archived" | "blocked")
    : "active";

  let botIds: string[] | undefined;
  if (!isAdmin) {
    const memberships = await prisma.botMember.findMany({
      where: { userId },
      select: { botId: true },
    });
    botIds = memberships.map((m) => m.botId);
  }
  if (requestedBotId) {
    botIds = botIds ? botIds.filter((id) => id === requestedBotId) : [requestedBotId];
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      bot: {
        organizationId: session.user.organizationId,
        ...(botIds ? { id: { in: botIds } } : {}),
      },
      ...(isAdmin ? {} : { OR: [{ assignedToId: null }, { assignedToId: userId }] }),
      ...(view === "archived"
        ? { status: "CLOSED" }
        : view === "blocked"
          ? { blocked: true }
          : { status: { not: "CLOSED" }, blocked: false }),
    },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      assignedTo: { select: { id: true, name: true, email: true, color: true } },
      bot: { select: { id: true, name: true, aiQualificationEnabled: true } },
    },
  });

  // Mensajes sin leer de TODAS las conversaciones en una sola consulta. Antes era un count por
  // conversación (cientos de consultas en cada poll de 3 s por cada pestaña abierta), que saturaba
  // la conexión a la base y dejaba el resto de las peticiones esperando.
  const unreadRows =
    conversations.length === 0
      ? []
      : await prisma.$queryRaw<{ conversationId: string; unread: bigint }[]>(Prisma.sql`
          SELECT m."conversationId", COUNT(*) AS unread
            FROM "messages" m
            LEFT JOIN "conversation_reads" r
              ON r."conversationId" = m."conversationId" AND r."userId" = ${userId}
           WHERE m."conversationId" IN (${Prisma.join(conversations.map((c) => c.id))})
             AND m."role" = 'CUSTOMER'
             AND m."createdAt" > COALESCE(r."lastReadAt", TIMESTAMP 'epoch')
           GROUP BY m."conversationId"`);
  const unreadByConversation = new Map(unreadRows.map((r) => [r.conversationId, Number(r.unread)]));

  return NextResponse.json(
    await Promise.all(
      conversations.map(async (c) => ({
        id: c.id,
        customerPhone: c.customerPhone,
        customerName: c.customerName,
        lastMessageAt: c.lastMessageAt,
        status: c.status,
        blocked: c.blocked,
        muted: c.muted,
        bot: { id: c.bot.id, name: c.bot.name },
        // Para mostrar en la lista si el bot está contestando esta
        // conversación o si escaló y todavía nadie del equipo respondió
        // (el mensaje más reciente sigue siendo el aviso SYSTEM de
        // escalamiento — en cuanto alguien manda un mensaje, deja de serlo).
        botActive: c.bot.aiQualificationEnabled && !c.botPaused,
        needsAttention:
          c.bot.aiQualificationEnabled && c.botPaused && c.messages[0]?.role === "SYSTEM",
        assignedTo: c.assignedTo
          ? {
              id: c.assignedTo.id,
              name: c.assignedTo.name || c.assignedTo.email,
              color: c.assignedTo.color,
            }
          : null,
        unreadCount: unreadByConversation.get(c.id) ?? 0,
        lastMessage: c.messages[0]
          ? {
              content: c.messages[0].content,
              role: c.messages[0].role,
              mediaType: c.messages[0].mediaType,
              createdAt: c.messages[0].createdAt,
            }
          : null,
      })),
    ),
  );
}
