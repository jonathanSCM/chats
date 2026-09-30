import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { getOrgStages, openStages, wonStage, type PipelineStage } from "@/server/services/pipeline";

/**
 * Funnel de marketing + métricas de negocio de Fase 4 (Dashboard Meta Ads).
 * Aparte de /api/dashboard/metrics (que sigue mostrando TODA la cartera,
 * incluidos leads orgánicos) -- acá el embudo arranca en el gasto
 * publicitario y se limita a oportunidades con atribución a un anuncio de
 * Meta (MetaAttributionTouch.opportunityId no nulo), para que el CAC/ROAS
 * midan específicamente lo que esa publicidad produjo.
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
  const city = searchParams.get("city");
  const campaignId = searchParams.get("campaignId");
  const adsetId = searchParams.get("adsetId");
  const adId = searchParams.get("adId");

  const dateRange = from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(`${to}T23:59:59`) : undefined } : undefined;

  // ── Gasto (AdSpendSnapshot) ─────────────────────────────────────────
  const spendRows = await prisma.adSpendSnapshot.findMany({
    where: {
      organizationId,
      ...(dateRange ? { date: dateRange } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(adsetId ? { adsetId } : {}),
      ...(adId ? { adId } : {}),
    },
    select: {
      campaignId: true,
      campaignName: true,
      adsetId: true,
      adsetName: true,
      adId: true,
      adName: true,
      spend: true,
      reach: true,
    },
  });

  const spendTotal = spendRows.reduce((sum, r) => sum + Number(r.spend), 0);
  const reachTotal = spendRows.reduce((sum, r) => sum + r.reach, 0);

  const spendByAd = new Map<
    string,
    { campaignName: string; adsetName: string; adName: string; campaignId: string; adsetId: string; spend: number }
  >();
  for (const r of spendRows) {
    const entry = spendByAd.get(r.adId) ?? {
      campaignName: r.campaignName,
      adsetName: r.adsetName,
      adName: r.adName,
      campaignId: r.campaignId,
      adsetId: r.adsetId,
      spend: 0,
    };
    entry.spend += Number(r.spend);
    spendByAd.set(r.adId, entry);
  }

  // ── Atribución (MetaAttributionTouch) ───────────────────────────────
  const touches = await prisma.metaAttributionTouch.findMany({
    where: {
      organizationId,
      ...(dateRange ? { capturedAt: dateRange } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(adsetId ? { adsetId } : {}),
      ...(adId ? { adId } : {}),
    },
    select: { conversationId: true, opportunityId: true, adId: true },
  });

  const conversacionesUnicas = new Set(touches.filter((t) => t.conversationId).map((t) => t.conversationId)).size;
  const attributedOpportunityIds = new Set(touches.filter((t) => t.opportunityId).map((t) => t.opportunityId as string));
  const opportunityIdToAdId = new Map(touches.filter((t) => t.opportunityId && t.adId).map((t) => [t.opportunityId as string, t.adId as string]));

  // ── Oportunidades atribuidas (filtradas por vendedor/servicio/fuente/ciudad) ─
  const stages = await getOrgStages(organizationId);
  const stageById = new Map(stages.map((s) => [s.id, s]));
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

  const opportunities = await prisma.opportunity.findMany({
    where: {
      organizationId,
      id: { in: [...attributedOpportunityIds] },
      ...(vendorId ? { assignedToId: vendorId } : {}),
      ...(service ? { serviceInterest: service } : {}),
      ...(source ? { contact: { source } } : {}),
      ...(city ? { contact: { city } } : {}),
    },
    select: {
      id: true,
      stageId: true,
      stage: { select: { id: true, role: true } },
      wonAt: true,
      lostAt: true,
      estimatedValue: true,
      currency: true,
      qualifiedEventSentAt: true,
      proposalSentAt: true,
    },
  });
  const opportunityIds = opportunities.map((o) => o.id);

  const stageEvents = opportunityIds.length
    ? await prisma.auditLog.findMany({
        where: { entityType: "Opportunity", entityId: { in: opportunityIds }, action: "stage_change" },
        select: { entityId: true, after: true },
      })
    : [];

  const reachedByOpportunity = new Map<string, Set<string>>();
  const auditedIds = new Set<string>();
  for (const ev of stageEvents) {
    auditedIds.add(ev.entityId);
    const afterId = resolveHistoricalStageId(ev.after);
    if (!afterId) continue;
    const set = reachedByOpportunity.get(ev.entityId) ?? new Set<string>();
    set.add(afterId);
    reachedByOpportunity.set(ev.entityId, set);
  }
  for (const o of opportunities) {
    if (auditedIds.has(o.id)) continue;
    const set = reachedByOpportunity.get(o.id) ?? new Set<string>();
    set.add(o.stageId);
    reachedByOpportunity.set(o.id, set);
  }

  const won = wonStage(stages);
  const funnelStages: PipelineStage[] = [...openStages(stages), ...(won ? [won] : [])];

  const funnel = [
    { stage: { id: "meta_ads", label: "Meta Ads (alcance)", color: null }, count: reachTotal, conversionFromPrev: null as number | null },
    {
      stage: { id: "conversaciones", label: "Conversaciones", color: null },
      count: conversacionesUnicas,
      conversionFromPrev: reachTotal > 0 ? conversacionesUnicas / reachTotal : null,
    },
    ...funnelStages.map((stage, i) => {
      const count = [...reachedByOpportunity.values()].filter((set) => set.has(stage.id)).length;
      const prevCount =
        i === 0 ? conversacionesUnicas : [...reachedByOpportunity.values()].filter((set) => set.has(funnelStages[i - 1].id)).length;
      return {
        stage: { id: stage.id, label: stage.label, color: stage.color },
        count,
        conversionFromPrev: prevCount > 0 ? count / prevCount : null,
      };
    }),
  ];

  // ── Métricas de negocio ──────────────────────────────────────────────
  const oportunidades = opportunities.length;
  const leadsCalificados = opportunities.filter((o) => o.qualifiedEventSentAt).length;
  const propuestas = opportunities.filter((o) => o.proposalSentAt).length;
  const ganadas = opportunities.filter((o) => o.wonAt);
  const abiertas = opportunities.filter((o) => !o.wonAt && !o.lostAt);

  const valorDelPipeline = abiertas.reduce((sum, o) => sum + Number(o.estimatedValue ?? 0), 0);
  const ingresoGanado = ganadas.reduce((sum, o) => sum + Number(o.estimatedValue ?? 0), 0);

  const metrics = {
    spend: spendTotal,
    conversaciones: conversacionesUnicas,
    oportunidades,
    leadsCalificados,
    propuestas,
    ganadas: ganadas.length,
    costoPorConversacion: conversacionesUnicas > 0 ? spendTotal / conversacionesUnicas : null,
    costoPorOportunidad: oportunidades > 0 ? spendTotal / oportunidades : null,
    costoPorLeadCalificado: leadsCalificados > 0 ? spendTotal / leadsCalificados : null,
    tasaCalificacion: oportunidades > 0 ? leadsCalificados / oportunidades : null,
    costoPorPropuesta: propuestas > 0 ? spendTotal / propuestas : null,
    CAC: ganadas.length > 0 ? spendTotal / ganadas.length : null,
    valorDelPipeline,
    ingresoGanado,
    ROAS: spendTotal > 0 ? ingresoGanado / spendTotal : null,
  };

  // ── Desglose por anuncio ─────────────────────────────────────────────
  const leadsByAd = new Map<string, number>();
  const ganadosByAd = new Map<string, number>();
  const ingresoByAd = new Map<string, number>();
  for (const o of opportunities) {
    const ad = opportunityIdToAdId.get(o.id);
    if (!ad) continue;
    leadsByAd.set(ad, (leadsByAd.get(ad) ?? 0) + 1);
    if (o.wonAt) {
      ganadosByAd.set(ad, (ganadosByAd.get(ad) ?? 0) + 1);
      ingresoByAd.set(ad, (ingresoByAd.get(ad) ?? 0) + Number(o.estimatedValue ?? 0));
    }
  }

  const breakdown = [...spendByAd.entries()]
    .map(([adIdKey, r]) => {
      const spend = r.spend;
      const leads = leadsByAd.get(adIdKey) ?? 0;
      const ganados = ganadosByAd.get(adIdKey) ?? 0;
      const ingreso = ingresoByAd.get(adIdKey) ?? 0;
      return {
        adId: adIdKey,
        adName: r.adName,
        adsetId: r.adsetId,
        adsetName: r.adsetName,
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        spend,
        leads,
        ganados,
        CAC: ganados > 0 ? spend / ganados : null,
        ROAS: spend > 0 ? ingreso / spend : null,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  return NextResponse.json({ funnel, metrics, breakdown });
}
