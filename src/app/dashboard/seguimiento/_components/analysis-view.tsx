"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { STAGE_LABEL, STAGE_COLOR, type Stage } from "@/lib/pipeline";

const money = new Intl.NumberFormat("es", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

interface FunnelEntry {
  stage: Stage;
  count: number;
  conversionFromPrev: number | null;
}

interface VendorRow {
  id: string;
  name: string;
  countOpen: number;
  countWon: number;
  countLost: number;
  winRate: number | null;
  valorGanado: number;
  ticketPromedio: number;
}

interface AnalyticsData {
  valorEnJuego: number;
  forecast: number;
  ganadoTotal: number;
  ticketPromedio: number;
  forecastPorMes: { mes: string; valor: number }[];
  valuePerStage: { stage: Stage; valor: number }[];
  avgDaysPerStage: { stage: Stage; avgDays: number | null; sampleSize: number }[];
  funnel: FunnelEntry[];
  historyStartsAt: string | null;
  vendorComparison: VendorRow[] | null;
}

function monthLabel(mes: string): string {
  if (mes === "sin_fecha") return "Sin fecha";
  const [y, m] = mes.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es", { month: "short", year: "numeric" });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="py-3">
      <CardDescription className="mb-1 font-mono text-[11px] uppercase tracking-wide">
        {label}
      </CardDescription>
      <CardTitle className="font-mono text-xl">{value}</CardTitle>
    </Card>
  );
}

export function AnalysisView({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/seguimiento/analytics")
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setData(json);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar el análisis.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="py-6 text-center text-sm text-danger">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
        <Loader2 size={14} className="animate-spin" /> Calculando…
      </p>
    );
  }

  const maxForecastMes = Math.max(1, ...data.forecastPorMes.map((m) => m.valor));
  const firstFunnelCount = data.funnel[0]?.count ?? 0;
  const maxValuePerStage = Math.max(1, ...data.valuePerStage.map((s) => s.valor));
  const maxAvgDays = Math.max(1, ...data.avgDaysPerStage.map((s) => s.avgDays ?? 0));

  return (
    <div className="space-y-6">
      <p className="text-xs text-ink-faint">
        Datos de toda la cartera de la organización, sin importar los filtros de arriba.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Valor en juego" value={money.format(data.valorEnJuego)} />
        <Stat label="Forecast ponderado" value={money.format(data.forecast)} />
        <Stat label="Ganado (total)" value={money.format(data.ganadoTotal)} />
        <Stat label="Ticket promedio" value={money.format(data.ticketPromedio)} />
      </div>

      <Card>
        <CardTitle className="mb-3 text-sm">Forecast por mes de cierre esperado</CardTitle>
        {data.forecastPorMes.length === 0 ? (
          <p className="text-sm text-ink-faint">
            Ninguna oportunidad abierta tiene fecha esperada de cierre cargada todavía.
          </p>
        ) : (
          <div className="space-y-2">
            {data.forecastPorMes.map((m) => (
              <div key={m.mes} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-ink-muted">{monthLabel(m.mes)}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-surface-2">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.max(4, (m.valor / maxForecastMes) * 100)}%`,
                      backgroundColor: STAGE_COLOR.PROPUESTA,
                    }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right font-mono text-ink-muted">
                  {money.format(m.valor)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle className="mb-3 text-sm">Monto total por etapa</CardTitle>
        <div className="space-y-2">
          {data.valuePerStage.map((s) => (
            <div key={s.stage} className="flex items-center gap-2 text-xs">
              <span className="w-36 shrink-0 truncate text-ink-muted">{STAGE_LABEL[s.stage]}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-surface-2">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${s.valor > 0 ? Math.max(4, (s.valor / maxValuePerStage) * 100) : 0}%`,
                    backgroundColor: STAGE_COLOR[s.stage],
                  }}
                />
              </div>
              <span className="w-20 shrink-0 text-right font-mono text-ink-muted">
                {money.format(s.valor)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle className="mb-1 text-sm">Días promedio por etapa</CardTitle>
        <p className="mb-3 text-[11px] text-ink-faint">
          Solo cuenta tramos completos (con salida a otra etapa) — auditados desde la Fase 1, así que
          el histórico todavía es corto.
        </p>
        <div className="space-y-2">
          {data.avgDaysPerStage.map((s) => (
            <div key={s.stage} className="flex items-center gap-2 text-xs">
              <span className="w-36 shrink-0 truncate text-ink-muted">{STAGE_LABEL[s.stage]}</span>
              {s.avgDays === null ? (
                <span className="text-ink-faint">Sin datos suficientes todavía</span>
              ) : (
                <>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-surface-2">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.max(4, (s.avgDays / maxAvgDays) * 100)}%`,
                        backgroundColor: STAGE_COLOR[s.stage],
                      }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right font-mono text-ink-muted">
                    {s.avgDays.toFixed(1)} días ({s.sampleSize})
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle className="mb-1 text-sm">Conversión entre etapas</CardTitle>
        {data.historyStartsAt && (
          <p className="mb-3 text-[11px] text-ink-faint">
            Historial de cambios de etapa desde el{" "}
            {new Date(data.historyStartsAt).toLocaleDateString("es")} — lo anterior a esa fecha se
            cuenta solo por la etapa en la que está cada oportunidad hoy.
          </p>
        )}
        <div className="space-y-2">
          {data.funnel.map((f) => (
            <div key={f.stage} className="flex items-center gap-2 text-xs">
              <span className="w-36 shrink-0 truncate text-ink-muted">{STAGE_LABEL[f.stage]}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-surface-2">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${firstFunnelCount > 0 ? Math.max(4, (f.count / firstFunnelCount) * 100) : 0}%`,
                    backgroundColor: STAGE_COLOR[f.stage],
                  }}
                />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-ink-muted">{f.count}</span>
              <span className="w-14 shrink-0 text-right font-mono text-ink-faint">
                {f.conversionFromPrev !== null ? `${Math.round(f.conversionFromPrev * 100)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {isAdmin && data.vendorComparison && (
        <Card>
          <CardTitle className="mb-3 text-sm">Comparación entre vendedores</CardTitle>
          <Table>
            <Thead>
              <tr>
                <Th>Vendedor</Th>
                <Th>Abiertas</Th>
                <Th>Ganadas</Th>
                <Th>Tasa de cierre</Th>
                <Th>Valor ganado</Th>
                <Th>Ticket promedio</Th>
              </tr>
            </Thead>
            <tbody>
              {data.vendorComparison.map((v) => (
                <Tr key={v.id}>
                  <Td>{v.name}</Td>
                  <Td className="font-mono">{v.countOpen}</Td>
                  <Td className="font-mono">{v.countWon}</Td>
                  <Td className="font-mono">
                    {v.winRate !== null ? `${Math.round(v.winRate * 100)}%` : "—"}
                  </Td>
                  <Td className="font-mono">{money.format(v.valorGanado)}</Td>
                  <Td className="font-mono">{money.format(v.ticketPromedio)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
