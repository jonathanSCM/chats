"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/input";

interface FunnelStep {
  stage: { id: string; label: string; color: string | null };
  count: number;
  conversionFromPrev: number | null;
}

interface Metrics {
  spend: number;
  conversaciones: number;
  oportunidades: number;
  leadsCalificados: number;
  propuestas: number;
  ganadas: number;
  costoPorConversacion: number | null;
  costoPorOportunidad: number | null;
  costoPorLeadCalificado: number | null;
  tasaCalificacion: number | null;
  costoPorPropuesta: number | null;
  CAC: number | null;
  valorDelPipeline: number;
  ingresoGanado: number;
  ROAS: number | null;
}

interface BreakdownRow {
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  leads: number;
  ganados: number;
  CAC: number | null;
  ROAS: number | null;
}

interface MarketingData {
  funnel: FunnelStep[];
  metrics: Metrics;
  breakdown: BreakdownRow[];
}

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  Manual: "Manual",
};

const money = new Intl.NumberFormat("es", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneyPrecise = new Intl.NumberFormat("es", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function m(v: number | null): string {
  return v === null ? "—" : moneyPrecise.format(v);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="py-3">
      <CardDescription className="mb-1 font-mono text-[11px] uppercase tracking-wide">{label}</CardDescription>
      <CardTitle className="font-mono text-xl">{value}</CardTitle>
    </Card>
  );
}

export function MarketingClient({
  members,
  sources,
  services,
  cities,
  campaigns,
  adsets,
  ads,
}: {
  members: { id: string; name: string }[];
  sources: string[];
  services: string[];
  cities: string[];
  campaigns: { id: string; name: string }[];
  adsets: { id: string; name: string }[];
  ads: { id: string; name: string }[];
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [source, setSource] = useState("");
  const [service, setService] = useState("");
  const [city, setCity] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [adsetId, setAdsetId] = useState("");
  const [adId, setAdId] = useState("");
  const [data, setData] = useState<MarketingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (vendorId) params.set("vendorId", vendorId);
    if (source) params.set("source", source);
    if (service) params.set("service", service);
    if (city) params.set("city", city);
    if (campaignId) params.set("campaignId", campaignId);
    if (adsetId) params.set("adsetId", adsetId);
    if (adId) params.set("adId", adId);
    fetch(`/api/dashboard/marketing?${params}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setData(json);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudieron cargar las métricas.");
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, vendorId, source, service, city, campaignId, adsetId, adId]);

  const anyFilter = from || to || vendorId || source || service || city || campaignId || adsetId || adId;

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Marketing</h1>
        <p className="text-sm text-ink-muted">Embudo comercial conectado al gasto de Meta Ads.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Desde" className="w-full py-1.5 text-sm sm:w-36" />
        <span className="text-xs text-ink-faint">–</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Hasta" className="w-full py-1.5 text-sm sm:w-36" />
        <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full py-1.5 text-sm sm:w-40">
          <option value="">Todo vendedor</option>
          {members.map((mem) => (
            <option key={mem.id} value={mem.id}>
              {mem.name}
            </option>
          ))}
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-full py-1.5 text-sm sm:w-36">
          <option value="">Toda fuente</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s] ?? s}
            </option>
          ))}
        </Select>
        <Select value={service} onChange={(e) => setService(e.target.value)} className="w-full py-1.5 text-sm sm:w-36">
          <option value="">Todo servicio</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={city} onChange={(e) => setCity(e.target.value)} className="w-full py-1.5 text-sm sm:w-36">
          <option value="">Toda ciudad</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="w-full py-1.5 text-sm sm:w-44">
          <option value="">Toda campaña</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={adsetId} onChange={(e) => setAdsetId(e.target.value)} className="w-full py-1.5 text-sm sm:w-44">
          <option value="">Todo conjunto</option>
          {adsets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select value={adId} onChange={(e) => setAdId(e.target.value)} className="w-full py-1.5 text-sm sm:w-44">
          <option value="">Todo anuncio</option>
          {ads.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        {anyFilter && (
          <button
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
              setVendorId("");
              setSource("");
              setService("");
              setCity("");
              setCampaignId("");
              setAdsetId("");
              setAdId("");
            }}
            className="cursor-pointer whitespace-nowrap text-xs text-ink-faint hover:text-accent"
          >
            Quitar filtros
          </button>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!data && !error && (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
          <Loader2 size={14} className="animate-spin" /> Calculando…
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Gasto" value={money.format(data.metrics.spend)} />
            <Stat label="CAC" value={m(data.metrics.CAC)} />
            <Stat label="ROAS" value={data.metrics.ROAS === null ? "—" : `${data.metrics.ROAS.toFixed(2)}x`} />
            <Stat label="Ingreso ganado" value={money.format(data.metrics.ingresoGanado)} />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Costo / conversación" value={m(data.metrics.costoPorConversacion)} />
            <Stat label="Costo / oportunidad" value={m(data.metrics.costoPorOportunidad)} />
            <Stat label="Costo / lead calificado" value={m(data.metrics.costoPorLeadCalificado)} />
            <Stat label="Costo / propuesta" value={m(data.metrics.costoPorPropuesta)} />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Tasa de calificación" value={pct(data.metrics.tasaCalificacion)} />
            <Stat label="Valor del pipeline" value={money.format(data.metrics.valorDelPipeline)} />
            <Stat label="Oportunidades" value={String(data.metrics.oportunidades)} />
            <Stat label="Ganadas" value={String(data.metrics.ganadas)} />
          </div>

          <Card>
            <CardTitle className="mb-3 text-sm">Embudo</CardTitle>
            <div className="space-y-2">
              {data.funnel.map((f, i) => {
                const first = data.funnel[0]?.count || 1;
                return (
                  <div key={f.stage.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs">
                    <span className="w-36 shrink-0 truncate text-ink-muted">{f.stage.label}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-surface-2">
                      <div
                        className="h-full rounded bg-accent"
                        style={{
                          width: `${Math.max(4, (f.count / first) * 100)}%`,
                          backgroundColor: f.stage.color ?? undefined,
                        }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right font-mono text-ink-muted">{f.count}</span>
                    <span className="w-12 shrink-0 text-right font-mono text-ink-faint">
                      {i === 0 ? "—" : pct(f.conversionFromPrev)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardTitle className="mb-1 text-sm">Desglose por anuncio</CardTitle>
            <CardDescription className="mb-3">Ordenado por gasto.</CardDescription>
            {data.breakdown.length === 0 ? (
              <p className="text-sm text-ink-faint">
                Sin datos todavía — el sync corre solo cada ~20h, puede tardar en aparecer la primera vez.
              </p>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th>Anuncio</Th>
                    <Th>Conjunto</Th>
                    <Th>Campaña</Th>
                    <Th>Gasto</Th>
                    <Th>Leads</Th>
                    <Th>Ganados</Th>
                    <Th>CAC</Th>
                    <Th>ROAS</Th>
                  </tr>
                </Thead>
                <tbody>
                  {data.breakdown.map((r) => (
                    <Tr key={r.adId}>
                      <Td className="max-w-48 truncate" title={r.adName}>
                        {r.adName || "—"}
                      </Td>
                      <Td className="max-w-40 truncate" title={r.adsetName}>
                        {r.adsetName || "—"}
                      </Td>
                      <Td className="max-w-40 truncate" title={r.campaignName}>
                        {r.campaignName || "—"}
                      </Td>
                      <Td className="font-mono">{money.format(r.spend)}</Td>
                      <Td className="font-mono">{r.leads}</Td>
                      <Td className="font-mono">{r.ganados}</Td>
                      <Td className="font-mono">{m(r.CAC)}</Td>
                      <Td className="font-mono">{r.ROAS === null ? "—" : `${r.ROAS.toFixed(2)}x`}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
