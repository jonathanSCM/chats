import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { deriveAlerts } from "@/lib/opportunity-alerts";
import { hasCompleteNextAction, ALL_LOSS_REASONS } from "@/lib/pipeline";
import { getOrgStages, openStages, wonStage, type PipelineStage } from "@/server/services/pipeline";

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
  const stages = await getOrgStages(organizationId);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  // Compatibilidad con AuditLog de ANTES de esta migración: esas filas
  // guardan el nombre viejo del enum fijo en `after.stage` (ej.
  // "POR_CALIFICAR"), no un stageId — se resuelve por posición (mismo
  // orden 1-9 que sembró la migración para cada organización).
  const LEGACY_STAGE_KEYS = [
    "POR_CALIFICAR",
    "ENTREVISTA",
    "DIAGNOSTICO",
    "PRESENTAR_SOLUCION",
    "PROPUESTA",
    "DECISION",
    "GANADO",
    "EN_PAUSA_NUTRIR",
    "PERDIDO",
  ];
  const stageByOrder = new Map(stages.map((s) => [s.order, s]));
  function resolveHistoricalStageId(raw: unknown): string | null {
    if (!raw || typeof raw !== "object") return null;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.stageId === "string" && stageById.has(rec.stageId)) return rec.stageId;
    if (typeof rec.stage === "string") {
      const idx = LEGACY_STAGE_KEYS.indexOf(rec.stage);
      if (idx !== -1) return stageByOrder.get(idx + 1)?.id ?? null;
    }
    return null;
  }

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
      stageId: true,
      stage: { select: { id: true, role: true } },
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
    prisma.user.findMany({ where: { organizationId, role: { not: "SYSTEM" } }, select: { id: true, name: true, email: true } }),
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
    const open = o.stage.role === null;
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
        stage: o.stage,
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
  const won = wonStage(stages);
  const funnelStages: PipelineStage[] = [...openStages(stages), ...(won ? [won] : [])];
  const reachedByOpportunity = new Map<string, Set<string>>();
  const auditedIds = new Set<string>();
  for (const ev of stageEvents) {
    auditedIds.add(ev.entityId);
    const after = resolveHistoricalStageId(ev.after);
    if (!after) continue;
    const set = reachedByOpportunity.get(ev.entityId) ?? new Set<string>();
    set.add(after);
    reachedByOpportunity.set(ev.entityId, set);
  }
  for (const o of opportunities) {
    if (auditedIds.has(o.id)) continue;
    const set = reachedByOpportunity.get(o.id) ?? new Set<string>();
    set.add(o.stageId);
    reachedByOpportunity.set(o.id, set);
  }
  const funnel = funnelStages.map((stage, i) => {
    const count = [...reachedByOpportunity.values()].filter((set) => set.has(stage.id)).length;
    const prevCount =
      i === 0
        ? null
        : [...reachedByOpportunity.values()].filter((set) => set.has(funnelStages[i - 1].id)).length;
    return {
      stage: { id: stage.id, label: stage.label, color: stage.color },
      count,
      conversionFromPrev: prevCount && prevCount > 0 ? count / prevCount : null,
    };
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
    if (o.stage.role === null) {
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
    wonStageId: won?.id ?? null,
    vendorPerformance,
    sources: bySourcePerformance,
    lossReasons,
  });
}
