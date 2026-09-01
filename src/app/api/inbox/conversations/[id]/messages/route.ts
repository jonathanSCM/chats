import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  // Traer TODO el historial en cada apertura y cada poll de 2s se vuelve
  // lento (y cada vez más lento) en conversaciones largas — se trae solo lo
  // reciente, que es lo que importa para responder y para calcular la
  // ventana de 24h/72h (el último mensaje del cliente casi siempre cae acá).
  // Con ?before=<ISO date> se pide la tanda anterior a ese mensaje (scroll
  // hacia arriba, "cargar más antiguos").
  const MESSAGE_LIMIT = 100;
  const before = req.nextUrl.searchParams.get("before");
  const beforeDate = before ? new Date(before) : null;
  const recentDesc = await prisma.message.findMany({
    where: {
      conversationId: id,
      ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { createdAt: { lt: beforeDate } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: MESSAGE_LIMIT,
    include: { sentBy: { select: { id: true, name: true, email: true, color: true } } },
  });
  const messages = recentDesc.slice().reverse();
  const hasMoreHistory = recentDesc.length === MESSAGE_LIMIT;

  // Pedir mensajes viejos no cuenta como "abrir" la conversación de nuevo —
  // solo se marca como leída en la carga inicial.
  if (!beforeDate) {
    await prisma.conversationRead.upsert({
      where: { conversationId_userId: { conversationId: id, userId: session.user.id } },
      create: { conversationId: id, userId: session.user.id },
      update: { lastReadAt: new Date() },
    });
  }

  // WhatsApp solo deja mandar texto libre dentro de las 24h desde el
  // último mensaje del cliente — pasado ese plazo, hace falta una
  // plantilla aprobada (ver services/whatsapp.ts). Se calcula acá, con los
  // mensajes que ya se trajeron, para no hacer otra consulta.
  //
  // Ojo: el "free entry point" de 72h de Meta para leads de anuncios NO
  // extiende este plazo — es solo una categoría de facturación (esa
  // conversación no se cobra durante 72h), pero WhatsApp igual rechaza el
  // mensaje si pasaron más de 24h sin que el cliente escriba, venga o no de
  // un anuncio (confirmado en producción: un mensaje fue rechazado con el
  // error 24h estando "dentro" del free entry point calculado). Por eso acá
  // NO se usa freeEntryPointUntil para esto — solo queda para mostrar el
  // origen del lead.
  const WINDOW_MS = 24 * 60 * 60 * 1000;
  const lastCustomerMessageAt = [...messages].reverse().find((m) => m.role === "CUSTOMER")?.createdAt;
  const outsideWindow =
    !lastCustomerMessageAt || Date.now() - lastCustomerMessageAt.getTime() > WINDOW_MS;

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      botId: conversation.botId,
      customerPhone: conversation.customerPhone,
      customerName: conversation.customerName,
      outsideWindow,
      status: conversation.status,
      blocked: conversation.blocked,
      botPaused: conversation.botPaused,
      aiQualificationEnabled: conversation.bot.aiQualificationEnabled,
      adReferral: conversation.adReferral,
      freeEntryPointUntil: conversation.freeEntryPointUntil,
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
      errorDetail: m.errorDetail,
    })),
    hasMoreHistory,
  });
}
