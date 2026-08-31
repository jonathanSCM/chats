import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { isOpenStage, type Stage } from "@/lib/pipeline";

/**
 * Contexto de CRM de una conversación: ficha del contacto, oportunidades,
 * notas internas y el equipo al que se puede transferir.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const organizationId = session.user.organizationId;

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      bot: { select: { organizationId: true, aiQualificationEnabled: true } },
      contact: {
        include: {
          company: { select: { id: true, name: true } },
          opportunities: {
            select: {
              id: true,
              title: true,
              stage: true,
              estimatedValue: true,
              nextAction: true,
              nextActionAt: true,
            },
            orderBy: { updatedAt: "desc" },
          },
        },
      },
      notes: {
        include: { user: { select: { id: true, name: true, email: true, color: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!conversation || conversation.bot.organizationId !== organizationId) {
    return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  }

  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  const isMine = !conversation.assignedToId || conversation.assignedToId === session.user.id;
  if (!isAdmin && !isMine) {
    return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
  }

  if (!isAdmin) {
    const hasBotAccess = await prisma.botMember.findUnique({
      where: { botId_userId: { botId: conversation.botId, userId: session.user.id } },
    });
    if (!hasBotAccess) {
      return NextResponse.json({ error: "No tienes acceso a esta cuenta de WhatsApp" }, { status: 403 });
    }
  }

  const team = await prisma.user.findMany({
    where: { organizationId },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    status: conversation.status,
    tags: conversation.tags,
    assignedToId: conversation.assignedToId,
    botPaused: conversation.botPaused,
    aiQualificationEnabled: conversation.bot.aiQualificationEnabled,
    contact: conversation.contact
      ? {
          id: conversation.contact.id,
          fullName: conversation.contact.fullName,
          phone: conversation.contact.phone,
          email: conversation.contact.email,
          city: conversation.contact.city,
          jobTitle: conversation.contact.jobTitle,
          company: conversation.contact.company,
          opportunities: conversation.contact.opportunities.map((o) => ({
            id: o.id,
            title: o.title,
            stage: o.stage,
            open: isOpenStage(o.stage as Stage),
            estimatedValue: o.estimatedValue ? Number(o.estimatedValue) : null,
            nextAction: o.nextAction,
            nextActionAt: o.nextActionAt?.toISOString() ?? null,
          })),
        }
      : null,
    notes: conversation.notes.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      author: n.user
        ? { id: n.user.id, name: n.user.name || n.user.email, color: n.user.color }
        : null,
    })),
    team: team.map((u) => ({ id: u.id, name: u.name || u.email })),
  });
}
