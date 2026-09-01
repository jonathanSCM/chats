import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { isOpenStage, STAGE_LABEL, type Stage } from "@/lib/pipeline";

const CONVERSATION_STATUS_LABEL: Record<string, string> = {
  OPEN: "Reabierta",
  ON_HOLD: "Pausada",
  CLOSED: "Archivada",
};

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

  // Historial: los movimientos del lead, uniendo lo que ya audita la propia
  // Conversation (archivar, bloquear, transferir) con lo que audita cada
  // Opportunity del mismo contacto (cambio de etapa, reasignación) — sin
  // tabla nueva, AuditLog ya tiene todo esto desde antes.
  const opportunityIds = conversation.contact?.opportunities.map((o) => o.id) ?? [];
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: "Conversation", entityId: conversation.id },
        ...(opportunityIds.length > 0
          ? [{ entityType: "Opportunity", entityId: { in: opportunityIds } }]
          : []),
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  const actorIds = [...new Set(auditLogs.map((l) => l.userId).filter((id): id is string => !!id))];
  const actorById = new Map(
    actorIds.length > 0
      ? (
          await prisma.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true, email: true },
          })
        ).map((u) => [u.id, u.name || u.email])
      : [],
  );
  const nameFor = (id: string | null) =>
    id ? (actorById.get(id) ?? team.find((u) => u.id === id)?.name ?? "—") : "Sin asignar";

  const history: { label: string; at: string; actor: string }[] = [
    { label: "Conversación iniciada", at: conversation.startedAt.toISOString(), actor: "Sistema" },
  ];
  for (const log of auditLogs) {
    const after = log.after as Record<string, unknown> | null;
    const actor =
      log.actor === "AI" ? "IA" : log.actor === "SYSTEM" ? "Sistema" : nameFor(log.userId);
    let label: string | null = null;
    if (log.entityType === "Conversation") {
      if (log.action === "status_change") {
        label = CONVERSATION_STATUS_LABEL[after?.status as string] ?? "Cambió de estado";
      } else if (log.action === "block") label = "Bloqueada";
      else if (log.action === "unblock") label = "Desbloqueada";
      else if (log.action === "transfer") label = `Tomada por ${nameFor(after?.assignedToId as string | null)}`;
      else if (log.action === "unassign") label = "Liberada (sin asignar)";
    } else if (log.entityType === "Opportunity") {
      if (log.action === "stage_change") {
        const stage = after?.stage as Stage | undefined;
        label = stage ? `Pasó a "${STAGE_LABEL[stage]}"` : "Cambió de etapa";
      } else if (log.action === "reassign") {
        const assignedToId = after?.assignedToId as string | null;
        label = assignedToId ? `Oportunidad asignada a ${nameFor(assignedToId)}` : "Oportunidad sin asignar";
      }
    }
    if (label) history.push({ label, at: log.createdAt.toISOString(), actor });
  }

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
    history,
  });
}
