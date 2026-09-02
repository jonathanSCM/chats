import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import {
  isOpenStage,
  hasCompleteNextAction,
  HIDDEN_BY_DEFAULT_STAGES,
  type Stage,
  type Priority,
  type LossReason,
} from "@/lib/pipeline";
import { getAiSpendToday } from "@/server/actions/crm";
import { TrackingTable } from "./_components/tracking-table";

export default async function SeguimientoPage({
  searchParams,
}: {
  searchParams: Promise<{
    archived?: string;
    open?: string;
    estado?: string;
    stage?: string;
    quick?: string;
    vendedor?: string;
    fuente?: string;
    servicio?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user.organizationId) redirect("/dashboard");

  const {
    archived,
    open: openId,
    estado,
    stage: initialStage,
    quick: initialQuickFilter,
    vendedor: initialAssignee,
    fuente: initialSource,
    servicio: initialService,
  } = await searchParams;
  const viewingArchived = archived === "1";
  // Independiente de "archivado": oculta por defecto lo Ganado/Perdido/En
  // pausa (siguen existiendo, solo no compiten visualmente con lo activo).
  const viewingAllStages = estado === "todos";

  const organizationId = session.user.organizationId;
  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";

  // Todo el equipo ve la misma cartera — lo que carga el admin lo puede
  // tomar cualquier vendedor. La edición queda restringida en el servidor
  // (canEditOpportunity) a quien la tiene asignada, o al admin.
  const [opportunities, contacts, members, ai] = await Promise.all([
    prisma.opportunity.findMany({
      where: {
        organizationId,
        archivedAt: viewingArchived ? { not: null } : null,
        ...(viewingArchived || viewingAllStages
          ? {}
          : { stage: { notIn: HIDDEN_BY_DEFAULT_STAGES } }),
      },
      include: {
        contact: { select: { id: true, fullName: true, phone: true, city: true, source: true } },
        assignedTo: { select: { id: true, name: true, email: true, color: true } },
        meetings: {
          select: {
            id: true,
            scheduledAt: true,
            durationMinutes: true,
            status: true,
            botStatus: true,
            botJoinedAt: true,
            botLeftAt: true,
            botEnabled: true,
            notes: true,
            transcript: true,
            audioTranscript: true,
            meetingUrl: true,
            attachments: {
              select: { id: true, url: true, fileName: true, mimeType: true, fileSize: true },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { scheduledAt: "desc" },
        },
      },
      orderBy: viewingArchived ? { updatedAt: "desc" } : { sortOrder: "asc" },
    }),
    prisma.contact.findMany({
      where: { organizationId },
      select: { id: true, fullName: true, phone: true },
      orderBy: { lastContactAt: "desc" },
      take: 300,
    }),
    prisma.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, email: true, color: true },
      orderBy: { createdAt: "asc" },
    }),
    getAiSpendToday(organizationId),
  ]);

  const rows = opportunities.map((o) => ({
    id: o.id,
    registeredAt: o.createdAt.toISOString(),
    client: o.contact.fullName ?? "",
    phone: o.contact.phone,
    city: o.contact.city ?? "",
    leadSource: o.contact.source ?? "",
    service: o.serviceInterest ?? "",
    need: o.needSummary ?? o.title,
    stage: o.stage as Stage,
    estimatedValue: o.estimatedValue ? Number(o.estimatedValue) : null,
    expectedCloseDate: o.expectedCloseDate?.toISOString() ?? null,
    updatedAt: o.updatedAt.toISOString(),
    lastUpdate: o.lastUpdate ?? "",
    priority: (o.priority as Priority | null) ?? null,
    nextContactAt: o.nextContactAt?.toISOString() ?? null,
    nextAction: o.nextAction ?? "",
    nextActionAt: o.nextActionAt?.toISOString() ?? null,
    probability: o.probability,
    aiRecommendation: o.aiRecommendation ?? "",
    aiSuggestedMessage: o.aiSuggestedMessage ?? "",
    aiMemory: o.aiMemory ?? "",
    leadScore: o.leadScore,
    leadScoreBreakdown: (o.leadScoreBreakdown as Record<string, number> | null) ?? null,
    leadScoreCoverage: o.leadScoreCoverage,
    aiPainPoint: o.aiPainPoint ?? "",
    aiMissingInfo: o.aiMissingInfo ?? "",
    aiNextQuestion: o.aiNextQuestion ?? "",
    aiAlerts: o.aiAlerts ?? "",
    authorityLevel: o.authorityLevel ?? "",
    lostReason: o.lostReason ?? "",
    lostReasonCategory: (o.lostReasonCategory as LossReason | null) ?? null,
    archived: o.archivedAt !== null,
    sortOrder: o.sortOrder,
    meetings: o.meetings.map((m) => ({
      id: m.id,
      scheduledAt: m.scheduledAt.toISOString(),
      durationMinutes: m.durationMinutes,
      status: m.status,
      botStatus: m.botStatus,
      botJoinedAt: m.botJoinedAt?.toISOString() ?? null,
      botLeftAt: m.botLeftAt?.toISOString() ?? null,
      botEnabled: m.botEnabled,
      notes: m.notes ?? "",
      transcript: m.transcript ?? "",
      audioTranscript: m.audioTranscript ?? "",
      meetingUrl: m.meetingUrl,
      attachments: m.attachments.map((a) => ({
        id: a.id,
        url: a.url,
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
      })),
    })),
    assignedTo: o.assignedTo
      ? { id: o.assignedTo.id, name: o.assignedTo.name || o.assignedTo.email, color: o.assignedTo.color }
      : null,
  }));

  // Los cuatro indicadores que el equipo lleva arriba de la planilla — ahora
  // orientados a la acción pendiente, no a la cotización.
  const open = rows.filter((r) => isOpenStage(r.stage));
  const todayStr = new Date().toISOString().slice(0, 10);
  const overdue = open.filter((r) => r.nextActionAt && r.nextActionAt.slice(0, 10) < todayStr);
  const withoutNextAction = open.filter((r) => !hasCompleteNextAction(r));

  return (
    <div className="animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Seguimiento comercial</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Oportunidades activas con acciones pendientes para avanzar en el proceso comercial.
      </p>

      <TrackingTable
        rows={rows}
        contacts={contacts.map((c) => ({ id: c.id, label: c.fullName || c.phone }))}
        members={members.map((m) => ({ id: m.id, name: m.name || m.email, color: m.color }))}
        currentUserId={session.user.id}
        isAdmin={isAdmin}
        viewingArchived={viewingArchived}
        viewingAllStages={viewingAllStages}
        openId={openId}
        initialStage={initialStage as Stage | undefined}
        initialQuickFilter={initialQuickFilter}
        initialAssignee={initialAssignee}
        initialSource={initialSource}
        initialService={initialService}
        ai={ai}
        summary={{
          activeCount: open.length,
          overdueCount: overdue.length,
          highPriorityCount: open.filter((r) => r.priority === "ALTA").length,
          noNextActionCount: withoutNextAction.length,
        }}
      />
    </div>
  );
}
