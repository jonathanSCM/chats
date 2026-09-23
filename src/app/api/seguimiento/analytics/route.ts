import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { getOrgStages, openStages, wonStage, type PipelineStage } from "@/server/services/pipeline";

/**
 * Analítica agregada de toda la cartera de la organización: valor del
 * pipeline, forecast por mes, embudo de conversión entre etapas y (solo
 * para admin) comparación entre vendedores. Se calcula en JS a partir de
 * `Opportunity` + `AuditLog` (que ya registra cada cambio de etapa como
 * `stage_change`, tanto desde la tabla como desde el drag&drop del
 * Kanban) — no hace falta una tabla de eventos nueva ni `groupBy` de
 * Prisma, el volumen de datos de un CRM así no lo justifica.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const organizationId = session.user.organizationId;
  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";

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

  const [opportunities, stageEvents, members, adConversations, opportunitiesWithPhone] = await Promise.all([
    prisma.opportunity.findMany({
      where: { organizationId },
      select: {
        id: true,
        stageId: true,
        stage: { select: { id: true, role: true } },
        estimatedValue: true,
        probability: true,
        expectedCloseDate: true,
        assignedToId: true,
        createdAt: true,
        wonAt: true,
        lostAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: { organizationId, entityType: "Opportunity", action: "stage_change" },
      select: { entityId: true, before: true, after: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, email: true },
    }),
    // Para el reporte por campaña, más abajo.
    prisma.conversation.findMany({
      where: { adReferral: true, bot: { organizationId } },
      orderBy: { startedAt: "asc" },
      select: { customerPhone: true, adReferralData: true },
    }),
    prisma.opportunity.findMany({
      where: { organizationId },
      select: { stageId: true, estimatedValue: true, wonAt: true, contact: { select: { phone: true } } },
    }),
  ]);

  // ── Valor del pipeline ──────────────────────────────────────────────
  let valorEnJuego = 0;
  let forecast = 0;
  let ganadoTotal = 0;
  let ganadoCount = 0;
  const forecastPorMes = new Map<string, number>();

  for (const o of opportunities) {
    const value = o.estimatedValue ? Number(o.estimatedValue) : 0;
    if (o.stage.role === null) {
      valorEnJuego += value;
      forecast += value * ((o.probability ?? 0) / 100);
      const bucket = o.expectedCloseDate
        ? o.expectedCloseDate.toISOString().slice(0, 7)
        : "sin_fecha";
      forecastPorMes.set(
        bucket,
        (forecastPorMes.get(bucket) ?? 0) + value * ((o.probability ?? 0) / 100),
      );
    }
    if (o.wonAt) {
      ganadoTotal += value;
      ganadoCount += 1;
    }
  }
  const ticketPromedio = ganadoCount > 0 ? ganadoTotal / ganadoCount : 0;

  // ── Monto total por etapa (todas, no solo abiertas — para ver dónde
  // se concentra la plata, incluyendo lo ya ganado/perdido) ───────────
  const valuePerStage = new Map<string, number>(stages.map((s) => [s.id, 0]));
  for (const o of opportunities) {
    valuePerStage.set(
      o.stageId,
      (valuePerStage.get(o.stageId) ?? 0) + (o.estimatedValue ? Number(o.estimatedValue) : 0),
    );
  }

  // ── Días promedio por etapa ──────────────────────────────────────────
  // Cada tramo entre dos stage_change consecutivos de una misma
  // oportunidad se le atribuye a la etapa en la que quedó tras el primer
  // cambio (after.stage). Solo cuenta tramos completos (con salida), no
  // el tiempo que lleva ahí mismo la etapa actual — eso sesgaría el
  // promedio hacia las etapas con más oportunidades todavía en curso.
  const eventsByOpportunity = new Map<string, typeof stageEvents>();
  for (const ev of stageEvents) {
    const arr = eventsByOpportunity.get(ev.entityId) ?? [];
    arr.push(ev);
    eventsByOpportunity.set(ev.entityId, arr);
  }
  const durationsByStage = new Map<string, number[]>(stages.map((s) => [s.id, []]));
  for (const events of eventsByOpportunity.values()) {
    for (let i = 0; i < events.length - 1; i++) {
      const stageId = resolveHistoricalStageId(events[i].after);
      if (!stageId) continue;
      const days = (events[i + 1].createdAt.getTime() - events[i].createdAt.getTime()) / 86_400_000;
      durationsByStage.get(stageId)?.push(days);
    }
  }
  const avgDaysPerStage = stages.map((stage) => {
    const samples = durationsByStage.get(stage.id) ?? [];
    return {
      stage: stage.label,
      color: stage.color,
      avgDays: samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : null,
      sampleSize: samples.length,
    };
  });

  // ── Embudo de conversión ────────────────────────────────────────────
  // Para cada etapa: cuántas oportunidades llegaron a ella alguna vez —
  // ya sea porque hay un stage_change con after.stage === etapa, o porque
  // están en esa etapa ahora mismo y nunca tuvieron ningún evento
  // auditado (datos que nacieron antes de que se empezara a auditar).
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
    // Sin ningún evento auditado: se asume que siempre estuvo en su etapa
    // actual (no se puede reconstruir el historial hacia atrás).
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
  const historyStartsAt = stageEvents[0]?.createdAt.toISOString() ?? null;

  // ── Comparación entre vendedores (solo admin) ───────────────────────
  let vendorComparison: unknown[] | null = null;
  if (isAdmin) {
    const byVendor = new Map<
      string,
      { countOpen: number; countWon: number; countLost: number; valorGanado: number }
    >();
    const key = (id: string | null) => id ?? "unassigned";
    for (const o of opportunities) {
      const k = key(o.assignedToId);
      const entry = byVendor.get(k) ?? { countOpen: 0, countWon: 0, countLost: 0, valorGanado: 0 };
      if (o.stage.role === null) entry.countOpen += 1;
      if (o.wonAt) {
        entry.countWon += 1;
        entry.valorGanado += o.estimatedValue ? Number(o.estimatedValue) : 0;
      }
      if (o.lostAt) entry.countLost += 1;
      byVendor.set(k, entry);
    }
    const memberById = new Map(members.map((m) => [m.id, m.name || m.email]));
    vendorComparison = [...byVendor.entries()]
      .map(([id, v]) => ({
        id,
        name: id === "unassigned" ? "Sin asignar" : (memberById.get(id) ?? "—"),
        countOpen: v.countOpen,
        countWon: v.countWon,
        countLost: v.countLost,
        winRate: v.countWon + v.countLost > 0 ? v.countWon / (v.countWon + v.countLost) : null,
        valorGanado: v.valorGanado,
        ticketPromedio: v.countWon > 0 ? v.valorGanado / v.countWon : 0,
      }))
      .sort((a, b) => b.valorGanado - a.valorGanado);
  }

  // ── Reporte por campaña/anuncio ─────────────────────────────────────
  // "Leads" se cuenta por teléfono, no por conversación — un mismo cliente
  // no debería aparecer dos veces aunque haya escrito más de una vez desde
  // el mismo (o distinto) anuncio. Se le atribuye a la campaña de su
  // PRIMER contacto marcado como venido de un anuncio (primer touch) —
  // mismo criterio que ya usa reportOpportunityWon() para la Conversions
  // API, para no tener dos lógicas de atribución distintas en la app.
  const campaignByPhone = new Map<string, string>();
  for (const c of adConversations) {
    if (campaignByPhone.has(c.customerPhone)) continue;
    const data = c.adReferralData as
      | { campaignName?: string | null; adName?: string | null; sourceId?: string | null }
      | null;
    const label =
      data?.campaignName || data?.adName || (data?.sourceId ? `Anuncio ${data.sourceId}` : "Sin datos del anuncio");
    campaignByPhone.set(c.customerPhone, label);
  }

  interface CampaignAgg {
    leads: number;
    won: number;
    wonValue: number;
  }
  const byCampaign = new Map<string, CampaignAgg>();
  for (const label of campaignByPhone.values()) {
    const entry = byCampaign.get(label) ?? { leads: 0, won: 0, wonValue: 0 };
    entry.leads += 1;
    byCampaign.set(label, entry);
  }
  for (const o of opportunitiesWithPhone) {
    const label = campaignByPhone.get(o.contact.phone);
    const entry = label ? byCampaign.get(label) : undefined;
    if (!entry || !o.wonAt) continue;
    entry.won += 1;
    entry.wonValue += o.estimatedValue ? Number(o.estimatedValue) : 0;
  }
  const campaignReport = [...byCampaign.entries()]
    .map(([campaign, v]) => ({ campaign, ...v }))
    .sort((a, b) => b.leads - a.leads);

  return NextResponse.json({
    valorEnJuego,
    forecast,
    ganadoTotal,
    ticketPromedio,
    forecastPorMes: [...forecastPorMes.entries()]
      .map(([mes, valor]) => ({ mes, valor }))
      .sort((a, b) => a.mes.localeCompare(b.mes)),
    valuePerStage: stages.map((stage) => ({
      stage: stage.label,
      color: stage.color,
      valor: valuePerStage.get(stage.id) ?? 0,
    })),
    // Color a usar en el gráfico de "Forecast por mes" — antes era el fijo
    // de PROPUESTA (STAGE_COLOR.PROPUESTA); ahora se resuelve por
    // requiresProposalFields ya que el id/nombre no es fijo por organización.
    forecastBarColor: stages.find((s) => s.requiresProposalFields)?.color ?? "#2563eb",
    avgDaysPerStage,
    funnel,
    historyStartsAt,
    vendorComparison,
    campaignReport,
  });
}
