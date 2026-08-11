import { NextResponse } from "next/server";
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
  const requestedBotId = new URL(request.url).searchParams.get("botId");

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
    },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      assignedTo: { select: { id: true, name: true, email: true, color: true } },
      reads: { where: { userId }, select: { lastReadAt: true } },
      bot: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(
    await Promise.all(
      conversations.map(async (c) => ({
        id: c.id,
        customerPhone: c.customerPhone,
        customerName: c.customerName,
        lastMessageAt: c.lastMessageAt,
        bot: { id: c.bot.id, name: c.bot.name },
        assignedTo: c.assignedTo
          ? {
              id: c.assignedTo.id,
              name: c.assignedTo.name || c.assignedTo.email,
              color: c.assignedTo.color,
            }
          : null,
        unreadCount: await prisma.message.count({
          where: {
            conversationId: c.id,
            role: "CUSTOMER",
            createdAt: { gt: c.reads[0]?.lastReadAt ?? new Date(0) },
          },
        }),
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
