import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Un vendedor (MEMBER) solo ve lo suyo + lo sin asignar; OWNER/SUPERADMIN ven todo.
  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  const userId = session.user.id;

  const conversations = await prisma.conversation.findMany({
    where: {
      bot: { organizationId: session.user.organizationId },
      ...(isAdmin ? {} : { OR: [{ assignedToId: null }, { assignedToId: userId }] }),
    },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      assignedTo: { select: { id: true, name: true, email: true } },
      reads: { where: { userId }, select: { lastReadAt: true } },
    },
  });

  return NextResponse.json(
    await Promise.all(
      conversations.map(async (c) => ({
        id: c.id,
        customerPhone: c.customerPhone,
        customerName: c.customerName,
        lastMessageAt: c.lastMessageAt,
        assignedTo: c.assignedTo
          ? { id: c.assignedTo.id, name: c.assignedTo.name || c.assignedTo.email }
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
