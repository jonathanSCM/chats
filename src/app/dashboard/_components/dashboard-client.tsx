"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, CalendarDays } from "lucide-react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/input";
import {
  STAGE_LABEL,
  STAGE_COLOR,
  LOSS_REASON_LABEL,
  SERVICES,
  type Stage,
  type LossReason,
} from "@/lib/pipeline";
import { vendorColor } from "@/lib/vendor-color";

interface UpcomingMeeting {
  id: string;
  scheduledAt: string;
  opportunityId: string | null;
  client: string;
  assignedTo: { id: string; name: string; color: string | null } | null;
}

interface Metrics {
  kpis: {
    activas: number;
    vencidas: number;
    sinProximaAccion: number;
    altaPrioridad: number;
    ganadas: number;
    tasaConversion: number | null;
    estancadas: number;
  };
  funnel: { stage: Stage; count: number; conversionFromPrev: number | null }[];
  vendorPerformance: {
    id: string;
    name: string;
    activas: number;
    vencidos: number;
    reuniones: number;
    propuestas: number;
    ganados: number;
    tasaConversion: number | null;
  }[];
  sources: {
    source: string;
    leads: number;
    oportunidades: number;
    reuniones: number;
    propuestas: number;
    ganados: number;
    tasaConversion: number | null;
  }[];
  lossReasons: { reason: LossReason; count: number }[];
}

const SOURCE_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  Manual: "Manual",
};

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function seguimientoHref(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `/dashboard/seguimiento${qs ? `?${qs}` : ""}`;
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <Card className={`py-3 ${href ? "transition-colors hover:border-accent-dim" : ""}`}>
      <CardDescription className="mb-1 font-mono text-[11px] uppercase tracking-wide">
        {label}
      </CardDescription>
      <CardTitle className="font-mono text-xl">{value}</CardTitle>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export function DashboardClient({
  userName,
  upcomingMeetings,
  members,
  sources,
}: {
  userName: string;
  upcomingMeetings: UpcomingMeeting[];
  members: { id: string; name: string }[];
  sources: string[];
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [source, setSource] = useState("");
  const [service, setService] = useState("");
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (vendorId) params.set("vendorId", vendorId);
    if (source) params.set("source", source);
    if (service) params.set("service", service);
    fetch(`/api/dashboard/metrics?${params}`)
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
  }, [from, to, vendorId, source, service]);

  const today = new Date().toLocaleDateString("es", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Hola, {userName} 👋</h1>
        <p className="text-sm capitalize text-ink-muted">{today}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Desde" className="w-full py-1.5 text-sm sm:w-36" />
        <span className="text-xs text-ink-faint">–</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Hasta" className="w-full py-1.5 text-sm sm:w-36" />
        <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full py-1.5 text-sm sm:w-40">
          <option value="">Todo vendedor</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
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
          {SERVICES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        {(from || to || vendorId || source || service) && (
          <button
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
              setVendorId("");
              setSource("");
              setService("");
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Stat label="Oportunidades activas" value={String(data.kpis.activas)} href={seguimientoHref({})} />
            <Stat
              label="Acciones vencidas"
              value={String(data.kpis.vencidas)}
              href={seguimientoHref({ quick: "vencidos" })}
            />
            <Stat
              label="Sin próxima acción"
              value={String(data.kpis.sinProximaAccion)}
              href={seguimientoHref({ quick: "sin_accion" })}
            />
            <Stat
              label="Prioridad alta"
              value={String(data.kpis.altaPrioridad)}
              href={seguimientoHref({ quick: "alta" })}
            />
            <Stat
              label="Ganadas"
              value={String(data.kpis.ganadas)}
              href={seguimientoHref({ estado: "todos", stage: "GANADO" })}
            />
            <Stat label="Tasa de conversión" value={pct(data.kpis.tasaConversion)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle className="mb-3 text-sm">Funnel comercial</CardTitle>
              <div className="space-y-2">
                {data.funnel.map((f, i) => {
                  const first = data.funnel[0]?.count || 1;
                  return (
                    <Link
                      key={f.stage}
                      href={seguimientoHref({ estado: "todos", stage: f.stage })}
                      className="flex items-center gap-2 rounded px-1 py-0.5 text-xs transition-colors hover:bg-surface-2/60"
                    >
                      <span className="w-32 shrink-0 truncate text-ink-muted">{STAGE_LABEL[f.stage]}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded bg-surface-2">
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${Math.max(4, (f.count / first) * 100)}%`,
                            backgroundColor: STAGE_COLOR[f.stage],
                          }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right font-mono text-ink-muted">{f.count}</span>
                      <span className="w-12 shrink-0 text-right font-mono text-ink-faint">
                        {i === 0 ? "—" : pct(f.conversionFromPrev)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </Card>

            <Card>
              <CardTitle className="mb-3 text-sm">Salud del pipeline</CardTitle>
              <div className="space-y-2">
                <Link
                  href={seguimientoHref({ quick: "vencidos" })}
                  className="flex items-center justify-between rounded px-2 py-2 text-sm transition-colors hover:bg-surface-2/60"
                >
                  <span className="text-ink-muted">⚠ Acciones vencidas</span>
                  <span className="font-mono font-semibold text-danger">{data.kpis.vencidas}</span>
                </Link>
                <Link
                  href={seguimientoHref({ quick: "sin_accion" })}
                  className="flex items-center justify-between rounded px-2 py-2 text-sm transition-colors hover:bg-surface-2/60"
                >
                  <span className="text-ink-muted">⚠ Sin próxima acción</span>
                  <span className="font-mono font-semibold text-warning">{data.kpis.sinProximaAccion}</span>
                </Link>
                <Link
                  href={seguimientoHref({ quick: "atencion" })}
                  className="flex items-center justify-between rounded px-2 py-2 text-sm transition-colors hover:bg-surface-2/60"
                >
                  <span className="text-ink-muted">⚠ Oportunidades estancadas</span>
                  <span className="font-mono font-semibold text-warning">{data.kpis.estancadas}</span>
                </Link>
              </div>
            </Card>
          </div>

          <Card>
            <CardTitle className="mb-3 text-sm">Rendimiento por vendedor</CardTitle>
            <Table>
              <Thead>
                <tr>
                  <Th>Vendedor</Th>
                  <Th>Activas</Th>
                  <Th>Vencidas</Th>
                  <Th>Reuniones</Th>
                  <Th>Propuestas</Th>
                  <Th>Ganadas</Th>
                  <Th>Tasa de cierre</Th>
                </tr>
              </Thead>
              <tbody>
                {data.vendorPerformance.map((v) => (
                  <Tr key={v.id}>
                    <Td>
                      <Link
                        href={v.id === "unassigned" ? seguimientoHref({}) : seguimientoHref({ vendedor: v.id })}
                        className="flex items-center gap-1.5 hover:text-accent"
                      >
                        {v.id !== "unassigned" && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: vendorColor(v.id, null) }}
                          />
                        )}
                        {v.name}
                      </Link>
                    </Td>
                    <Td className="font-mono">{v.activas}</Td>
                    <Td className="font-mono">{v.vencidos}</Td>
                    <Td className="font-mono">{v.reuniones}</Td>
                    <Td className="font-mono">{v.propuestas}</Td>
                    <Td className="font-mono">{v.ganados}</Td>
                    <Td className="font-mono">{pct(v.tasaConversion)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle className="mb-3 text-sm">Fuentes</CardTitle>
              {data.sources.length === 0 ? (
                <p className="text-sm text-ink-faint">Sin datos de fuente todavía.</p>
              ) : (
                <Table>
                  <Thead>
                    <tr>
                      <Th>Fuente</Th>
                      <Th>Leads</Th>
                      <Th>Oport.</Th>
                      <Th>Ganados</Th>
                      <Th>Conv.</Th>
                    </tr>
                  </Thead>
                  <tbody>
                    {data.sources.map((s) => (
                      <Tr key={s.source}>
                        <Td>
                          <Link href={seguimientoHref({ fuente: s.source })} className="hover:text-accent">
                            {SOURCE_LABEL[s.source] ?? s.source}
                          </Link>
                        </Td>
                        <Td className="font-mono">{s.leads}</Td>
                        <Td className="font-mono">{s.oportunidades}</Td>
                        <Td className="font-mono">{s.ganados}</Td>
                        <Td className="font-mono">{pct(s.tasaConversion)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>

            <Card>
              <CardTitle className="mb-3 text-sm">Razones de pérdida</CardTitle>
              {data.lossReasons.length === 0 ? (
                <p className="text-sm text-ink-faint">
                  Todavía no hay oportunidades perdidas con motivo cargado.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.lossReasons.map((r) => {
                    const max = data.lossReasons[0]?.count || 1;
                    return (
                      <Link
                        key={r.reason}
                        href={seguimientoHref({ estado: "todos", stage: "PERDIDO" })}
                        className="flex items-center gap-2 rounded px-1 py-0.5 text-xs transition-colors hover:bg-surface-2/60"
                      >
                        <span className="w-32 shrink-0 truncate text-ink-muted">{LOSS_REASON_LABEL[r.reason]}</span>
                        <div className="h-4 flex-1 overflow-hidden rounded bg-surface-2">
                          <div
                            className="h-full rounded bg-danger/70"
                            style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }}
                          />
                        </div>
                        <span className="w-6 shrink-0 text-right font-mono text-ink-muted">{r.count}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <CalendarDays size={15} /> Próximas reuniones
          </CardTitle>
          <Link href="/dashboard/calendario" className="text-xs text-accent hover:underline">
            Ver calendario
          </Link>
        </div>
        {upcomingMeetings.length === 0 ? (
          <p className="text-sm text-ink-faint">No hay reuniones agendadas todavía.</p>
        ) : (
          <div className="space-y-2">
            {upcomingMeetings.map((m) => (
              <Link
                key={m.id}
                href={m.opportunityId ? `/dashboard/seguimiento?open=${m.opportunityId}` : "/dashboard/calendario"}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-surface-2/60"
              >
                <span className="w-28 shrink-0 font-mono text-xs text-ink-muted">
                  {new Date(m.scheduledAt).toLocaleDateString("es", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="flex-1 truncate text-ink">{m.client}</span>
                {m.assignedTo && (
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                    style={{ backgroundColor: vendorColor(m.assignedTo.id, m.assignedTo.color) }}
                    title={m.assignedTo.name}
                  >
                    {m.assignedTo.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
