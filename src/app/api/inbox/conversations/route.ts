import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";

export async function GET() {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const conversations = await prisma.conversation.findMany({
    where: { bot: { organizationId: session.user.organizationId } },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return NextResponse.json(
    conversations.map((c) => ({
      id: c.id,
      customerPhone: c.customerPhone,
      lastMessageAt: c.lastMessageAt,
      lastMessage: c.messages[0]
        ? {
            content: c.messages[0].content,
            role: c.messages[0].role,
            mediaType: c.messages[0].mediaType,
            createdAt: c.messages[0].createdAt,
          }
        : null,
    })),
  );
}
