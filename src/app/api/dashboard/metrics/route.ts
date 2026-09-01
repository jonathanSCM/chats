import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { deriveAlerts } from "@/lib/opportunity-alerts";
import { hasCompleteNextAction, isOpenStage, OPEN_STAGES, ALL_LOSS_REASONS, type Stage } from "@/lib/pipeline";

/**
 * Métricas del Dashboard (scope §1-8): KPIs, funnel con conversión,
 * estancadas, rendimiento por vendedor, fuentes y razones de pérdida —
 * todo recalculado según los filtros recibidos (fecha/vendedor/fuente/
 * servicio), que es justo lo que necesita esta pantalla y lo que la
 * analítica de Seguimiento (`/api/seguimiento/analytics`, sin filtros)
 * no resuelve. Se calcula en JS, mismo criterio que esa ruta.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const organizationId = session.user.organizationId;

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const vendorId = searchParams.get("vendorId");
  const source = searchParams.get("source");
  const service = searchParams.get("service");

  const opportunities = await prisma.opportunity.findMany({
    where: {
      organizationId,
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
            },
          }
        : {}),
      ...(vendorId ? { assignedToId: vendorId } : {}),
      ...(service ? { serviceInterest: service } : {}),
      ...(source ? { contact: { source } } : {}),
    },
    select: {
      id: true,
      stage: true,
      priority: true,
      leadScore: true,
      nextAction: true,
      nextActionAt: true,
      expectedCloseDate: true,
      estimatedValue: true,
      assignedToId: true,
      wonAt: true,
      lostAt: true,
      lostReasonCategory: true,
      proposalSentAt: true,
      updatedAt: true,
      createdAt: true,
      assignedTo: { select: { name: true, email: true } },
      contact: { select: { id: true, source: true } },
    },
  });

  const opportunityIds = opportunities.map((o) => o.id);
  const [stageEvents, meetings, members] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entityType: "Opportunity", entityId: { in: opportunityIds }, action: "stage_change" },
      select: { entityId: true, after: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.meeting.findMany({
      where: { opportunityId: { in: opportunityIds }, status: "DONE" },
      select: { opportunityId: true },
    }),
    prisma.user.findMany({ where: { organizationId }, select: { id: true, name: true, email: true } }),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m.name || m.email]));

  const todayStr = new Date().toISOString().slice(0, 10);

  // ── KPIs ──────────────────────────────────────────────────────────
  let activas = 0;
  let vencidas = 0;
  let sinProximaAccion = 0;
  let altaPrioridad = 0;
  let ganadas = 0;
  let perdidas = 0;

  for (const o of opportunities) {
    const open = isOpenStage(o.stage as Stage);
    if (open) {
      activas += 1;
      if (o.nextActionAt && o.nextActionAt.toISOString().slice(0, 10) < todayStr) vencidas += 1;
      if (
        !hasCompleteNextAction({
          nextAction: o.nextAction ?? "",
          nextActionAt: o.nextActionAt?.toISOString() ?? null,
          assignedTo: o.assignedToId,
        })
      ) {
        sinProximaAccion += 1;
      }
      if (o.priority === "ALTA") altaPrioridad += 1;
    }
    if (o.wonAt) ganadas += 1;
    if (o.lostAt) perdidas += 1;
  }
  const tasaConversion = ganadas + perdidas > 0 ? ganadas / (ganadas + perdidas) : null;

  // ── Estancadas (misma regla que las alertas de Seguimiento) ─────────
  let estancadas = 0;
  for (const o of opportunities) {
    const alert = deriveAlerts(
      {
        stage: o.stage as Stage,
        priority: o.priority as "ALTA" | "MEDIA" | "BAJA" | null,
        leadScore: o.leadScore,
        nextAction: o.nextAction ?? "",
        nextActionAt: o.nextActionAt?.toISOString() ?? null,
        expectedCloseDate: o.expectedCloseDate?.toISOString() ?? null,
        updatedAt: o.updatedAt.toISOString(),
        assignedTo: o.assignedToId,
      },
      todayStr,
    );
    if (alert.reasons.some((r) => r.startsWith("Sin cambios"))) estancadas += 1;
  }

  // ── Funnel + conversión entre etapas ────────────────────────────────
  const funnelStages: Stage[] = [...OPEN_STAGES, "GANADO"];
  const reachedByOpportunity = new Map<string, Set<Stage>>();
  const auditedIds = new Set<string>();
  for (const ev of stageEvents) {
    auditedIds.add(ev.entityId);
    const after = (ev.after as { stage?: string } | null)?.stage as Stage | undefined;
    if (!after) continue;
    const set = reachedByOpportunity.get(ev.entityId) ?? new Set<Stage>();
    set.add(after);
    reachedByOpportunity.set(ev.entityId, set);
  }
  for (const o of opportunities) {
    if (auditedIds.has(o.id)) continue;
    const set = reachedByOpportunity.get(o.id) ?? new Set<Stage>();
    set.add(o.stage as Stage);
    reachedByOpportunity.set(o.id, set);
  }
  const funnel = funnelStages.map((stage, i) => {
    const count = [...reachedByOpportunity.values()].filter((set) => set.has(stage)).length;
    const prevCount =
      i === 0 ? null : [...reachedByOpportunity.values()].filter((set) => set.has(funnelStages[i - 1])).length;
    return { stage, count, conversionFromPrev: prevCount && prevCount > 0 ? count / prevCount : null };
  });

  // ── Rendimiento por vendedor ─────────────────────────────────────────
  const doneMeetingsByOpp = new Set(meetings.map((m) => m.opportunityId));
  const byVendor = new Map<
    string,
    { activas: number; vencidos: number; reuniones: number; propuestas: number; ganados: number; perdidos: number }
  >();
  for (const o of opportunities) {
    const key = o.assignedToId ?? "unassigned";
    const entry =
      byVendor.get(key) ?? { activas: 0, vencidos: 0, reuniones: 0, propuestas: 0, ganados: 0, perdidos: 0 };
    if (isOpenStage(o.stage as Stage)) {
      entry.activas += 1;
      if (o.nextActionAt && o.nextActionAt.toISOString().slice(0, 10) < todayStr) entry.vencidos += 1;
    }
    if (doneMeetingsByOpp.has(o.id)) entry.reuniones += 1;
    if (o.proposalSentAt) entry.propuestas += 1;
    if (o.wonAt) entry.ganados += 1;
    if (o.lostAt) entry.perdidos += 1;
    byVendor.set(key, entry);
  }
  const vendorPerformance = [...byVendor.entries()]
    .map(([id, v]) => ({
      id,
      name: id === "unassigned" ? "Sin asignar" : (memberById.get(id) ?? "—"),
      ...v,
      tasaConversion: v.ganados + v.perdidos > 0 ? v.ganados / (v.ganados + v.perdidos) : null,
    }))
    .sort((a, b) => b.ganados - a.ganados);

  // ── Fuentes ──────────────────────────────────────────────────────────
  const bySource = new Map<
    string,
    { leadIds: Set<string>; oportunidades: number; reuniones: number; propuestas: number; ganados: number; perdidos: number }
  >();
  for (const o of opportunities) {
    const key = o.contact.source || "Sin especificar";
    const entry =
      bySource.get(key) ?? { leadIds: new Set<string>(), oportunidades: 0, reuniones: 0, propuestas: 0, ganados: 0, perdidos: 0 };
    entry.leadIds.add(o.contact.id);
    entry.oportunidades += 1;
    if (doneMeetingsByOpp.has(o.id)) entry.reuniones += 1;
    if (o.proposalSentAt) entry.propuestas += 1;
    if (o.wonAt) entry.ganados += 1;
    if (o.lostAt) entry.perdidos += 1;
    bySource.set(key, entry);
  }
  const bySourcePerformance = [...bySource.entries()]
    .map(([source, v]) => ({
      source,
      leads: v.leadIds.size,
      oportunidades: v.oportunidades,
      reuniones: v.reuniones,
      propuestas: v.propuestas,
      ganados: v.ganados,
      tasaConversion: v.ganados + v.perdidos > 0 ? v.ganados / (v.ganados + v.perdidos) : null,
    }))
    .sort((a, b) => b.oportunidades - a.oportunidades);

  // ── Razones de pérdida ───────────────────────────────────────────────
  const lossCounts = new Map<string, number>(ALL_LOSS_REASONS.map((r) => [r, 0]));
  for (const o of opportunities) {
    if (o.lostAt && o.lostReasonCategory) {
      lossCounts.set(o.lostReasonCategory, (lossCounts.get(o.lostReasonCategory) ?? 0) + 1);
    }
  }
  const lossReasons = [...lossCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    kpis: { activas, vencidas, sinProximaAccion, altaPrioridad, ganadas, tasaConversion, estancadas },
    funnel,
    vendorPerformance,
    sources: bySourcePerformance,
    lossReasons,
  });
}
