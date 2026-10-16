import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { getOrgStages, openStages } from "@/server/services/pipeline";
import {
  aggregateObjections,
  firstResponseMinutes,
  median,
  stageDwellDays,
  type Outcome,
} from "@/lib/learning";
import { ALL_LOSS_REASONS } from "@/lib/pipeline";

/**
 * F13 — análisis de aprendizaje: dónde se pierden los leads, cuánto tarda
 * cada etapa, qué objeciones aparecen en las reuniones y qué tan rápido se
 * responde. Solo lectura y sin IA: las recomendaciones salen de estos datos
 * en un paso aparte y pasan por el editor de conocimiento (siempre con
 * aprobación humana).
 */
const STALE_DAYS = 14;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const organizationId = session.user.organizationId;

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 90);
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(Math.round(daysParam), 7), 365) : 90;
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);

  const stages = await getOrgStages(organizationId);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const open = openStages(stages);

  const opportunities = await prisma.opportunity.findMany({
    where: { organizationId, createdAt: { gte: since } },
    select: {
      id: true,
      stageId: true,
      stage: { select: { role: true } },
      wonAt: true,
      lostAt: true,
      lostReasonCategory: true,
      updatedAt: true,
      createdAt: true,
      proposalSentAt: true,
      assignedToId: true,
    },
  });
  const ids = opportunities.map((o) => o.id);

  const [events, meetings, messages] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entityType: "Opportunity", entityId: { in: ids }, action: "stage_change" },
      select: { entityId: true, after: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.meeting.findMany({
      where: { opportunityId: { in: ids }, status: "DONE", aiSummaryAt: { not: null } },
      select: { opportunityId: true, aiSummaryData: true },
    }),
    prisma.message.findMany({
      where: {
        conversation: { bot: { organizationId } },
        createdAt: { gte: since },
        role: { in: ["CUSTOMER", "STAFF"] },
      },
      select: { conversationId: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 50_000,
    }),
  ]);

  const stageEvents = events.flatMap((e) => {
    const after = e.after as { stageId?: string } | null;
    return after?.stageId && stageById.has(after.stageId)
      ? [{ opportunityId: e.entityId, stageId: after.stageId, at: e.createdAt }]
      : [];
  });

  // ── Dónde se pierden: última etapa abierta antes de perder + estancadas ─────
  const lastOpenBeforeLoss = new Map<string, string>();
  for (const e of stageEvents) {
    if (stageById.get(e.stageId)?.role === null) lastOpenBeforeLoss.set(e.opportunityId, e.stageId);
  }
  const lostByStage = new Map<string, number>();
  const staleByStage = new Map<string, number>();
  for (const o of opportunities) {
    if (o.lostAt) {
      const sid = lastOpenBeforeLoss.get(o.id);
      if (sid) lostByStage.set(sid, (lostByStage.get(sid) ?? 0) + 1);
    } else if (o.stage.role === null) {
      const idle = (now.getTime() - o.updatedAt.getTime()) / 86_400_000;
      if (idle >= STALE_DAYS) staleByStage.set(o.stageId, (staleByStage.get(o.stageId) ?? 0) + 1);
    }
  }

  // ── Tiempo por etapa ────────────────────────────────────────────────────
  const openIds = new Set(opportunities.filter((o) => o.stage.role === null).map((o) => o.id));
  const dwell = stageDwellDays(stageEvents, openIds, now);

  const stageStats = open.map((s) => {
    const list = dwell.get(s.id) ?? [];
    const med = median(list);
    return {
      stage: { id: s.id, label: s.label, color: s.color },
      medianDays: med === null ? null : Math.round(med * 10) / 10,
      samples: list.length,
      lost: lostByStage.get(s.id) ?? 0,
      stale: staleByStage.get(s.id) ?? 0,
    };
  });

  // ── Objeciones de reuniones cruzadas con el resultado ───────────────────
  const outcomeById = new Map<string, Outcome>(
    opportunities.map((o) => [o.id, o.wonAt ? "won" : o.lostAt ? "lost" : "open"]),
  );
  const textsByOpp = new Map<string, string[]>();
  for (const m of meetings) {
    const data = m.aiSummaryData as { informacionComercial?: { objeciones?: unknown } } | null;
    const objeciones = data?.informacionComercial?.objeciones;
    if (!m.opportunityId || !Array.isArray(objeciones)) continue;
    const list = textsByOpp.get(m.opportunityId) ?? [];
    for (const t of objeciones) if (typeof t === "string") list.push(t);
    textsByOpp.set(m.opportunityId, list);
  }
  const objections = aggregateObjections(
    [...textsByOpp.entries()].map(([id, texts]) => ({ texts, outcome: outcomeById.get(id) ?? "open" })),
  );

  // ── Conversión con/sin reunión y razones de pérdida ─────────────────────
  const withMeeting = new Set(meetings.map((m) => m.opportunityId));
  const closed = opportunities.filter((o) => o.wonAt || o.lostAt);
  const rate = (rows: typeof closed) =>
    rows.length === 0 ? null : rows.filter((o) => o.wonAt).length / rows.length;
  const meetingImpact = {
    withMeeting: { closed: closed.filter((o) => withMeeting.has(o.id)).length, winRate: rate(closed.filter((o) => withMeeting.has(o.id))) },
    withoutMeeting: { closed: closed.filter((o) => !withMeeting.has(o.id)).length, winRate: rate(closed.filter((o) => !withMeeting.has(o.id))) },
  };

  const lossCounts = new Map<string, number>(ALL_LOSS_REASONS.map((r) => [r, 0]));
  for (const o of opportunities) {
    if (o.lostAt && o.lostReasonCategory) lossCounts.set(o.lostReasonCategory, (lossCounts.get(o.lostReasonCategory) ?? 0) + 1);
  }
  const lossReasons = [...lossCounts.entries()]
    .filter(([, c]) => c > 0)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // ── Respuesta ───────────────────────────────────────────────────────────
  const responses = firstResponseMinutes(
    messages.map((m) => ({ conversationId: m.conversationId, role: m.role, createdAt: m.createdAt })),
  );
  const respMedian = median(responses);
  const slowShare = responses.length ? responses.filter((m) => m > 60).length / responses.length : null;

  return NextResponse.json({
    days,
    totals: {
      opportunities: opportunities.length,
      won: opportunities.filter((o) => o.wonAt).length,
      lost: opportunities.filter((o) => o.lostAt).length,
    },
    stageStats,
    objections,
    meetingImpact,
    lossReasons,
    response: {
      conversations: responses.length,
      medianMinutes: respMedian === null ? null : Math.round(respMedian),
      slowShare,
    },
  });
}
