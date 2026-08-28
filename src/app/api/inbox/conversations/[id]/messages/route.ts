import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { bot: true, assignedTo: { select: { id: true, name: true, email: true, color: true } } },
  });

  if (!conversation || conversation.bot.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }

  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  const isMine = !conversation.assignedToId || conversation.assignedToId === session.user.id;
  if (!isAdmin && !isMine) {
    return NextResponse.json({ error: "Este chat está asignado a otro vendedor" }, { status: 403 });
  }

  if (!isAdmin) {
    const hasBotAccess = await prisma.botMember.findUnique({
      where: { botId_userId: { botId: conversation.botId, userId: session.user.id } },
    });
    if (!hasBotAccess) {
      return NextResponse.json({ error: "No tienes acceso a esta cuenta de WhatsApp" }, { status: 403 });
    }
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    include: { sentBy: { select: { id: true, name: true, email: true, color: true } } },
  });

  await prisma.conversationRead.upsert({
    where: { conversationId_userId: { conversationId: id, userId: session.user.id } },
    create: { conversationId: id, userId: session.user.id },
    update: { lastReadAt: new Date() },
  });

  // WhatsApp solo deja mandar texto libre dentro de las 24h desde el
  // último mensaje del cliente — pasado ese plazo, hace falta una
  // plantilla aprobada (ver services/whatsapp.ts). Se calcula acá, con los
  // mensajes que ya se trajeron, para no hacer otra consulta.
  const WINDOW_MS = 24 * 60 * 60 * 1000;
  const lastCustomerMessageAt = [...messages].reverse().find((m) => m.role === "CUSTOMER")?.createdAt;
  const outsideWindow = !lastCustomerMessageAt || Date.now() - lastCustomerMessageAt.getTime() > WINDOW_MS;

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      botId: conversation.botId,
      customerPhone: conversation.customerPhone,
      customerName: conversation.customerName,
      outsideWindow,
      status: conversation.status,
      blocked: conversation.blocked,
      assignedTo: conversation.assignedTo
        ? {
            id: conversation.assignedTo.id,
            name: conversation.assignedTo.name || conversation.assignedTo.email,
            color: conversation.assignedTo.color,
          }
        : null,
    },
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      mediaUrl: m.mediaUrl,
      mediaType: m.mediaType,
      mediaStatus: m.mediaStatus,
      mimeType: m.mimeType,
      fileName: m.fileName,
      viaPhoneApp: m.viaPhoneApp,
      isHistorical: m.isHistorical,
      sentBy: m.sentBy
        ? { id: m.sentBy.id, name: m.sentBy.name || m.sentBy.email, color: m.sentBy.color }
        : null,
      status: m.status,
    })),
  });
}
