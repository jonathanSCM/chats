import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { OPEN_STAGES, isOpenStage, type Stage } from "@/lib/pipeline";

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

  const [opportunities, stageEvents, members] = await Promise.all([
    prisma.opportunity.findMany({
      where: { organizationId },
      select: {
        id: true,
        stage: true,
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
  ]);

  // ── Valor del pipeline ──────────────────────────────────────────────
  let valorEnJuego = 0;
  let forecast = 0;
  let ganadoTotal = 0;
  let ganadoCount = 0;
  const forecastPorMes = new Map<string, number>();

  for (const o of opportunities) {
    const value = o.estimatedValue ? Number(o.estimatedValue) : 0;
    if (isOpenStage(o.stage as Stage)) {
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

  // ── Embudo de conversión ────────────────────────────────────────────
  // Para cada etapa: cuántas oportunidades llegaron a ella alguna vez —
  // ya sea porque hay un stage_change con after.stage === etapa, o porque
  // están en esa etapa ahora mismo y nunca tuvieron ningún evento
  // auditado (datos que nacieron antes de que se empezara a auditar).
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
    // Sin ningún evento auditado: se asume que siempre estuvo en su etapa
    // actual (no se puede reconstruir el historial hacia atrás).
    const set = reachedByOpportunity.get(o.id) ?? new Set<Stage>();
    set.add(o.stage as Stage);
    reachedByOpportunity.set(o.id, set);
  }

  const funnel = funnelStages.map((stage, i) => {
    const count = [...reachedByOpportunity.values()].filter((set) => set.has(stage)).length;
    const prevCount =
      i === 0
        ? null
        : [...reachedByOpportunity.values()].filter((set) => set.has(funnelStages[i - 1])).length;
    return {
      stage,
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
      if (isOpenStage(o.stage as Stage)) entry.countOpen += 1;
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

  return NextResponse.json({
    valorEnJuego,
    forecast,
    ganadoTotal,
    ticketPromedio,
    forecastPorMes: [...forecastPorMes.entries()]
      .map(([mes, valor]) => ({ mes, valor }))
      .sort((a, b) => a.mes.localeCompare(b.mes)),
    funnel,
    historyStartsAt,
    vendorComparison,
  });
}
