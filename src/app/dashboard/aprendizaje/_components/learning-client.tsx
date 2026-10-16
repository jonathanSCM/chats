"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { Select } from "@/components/ui/input";

interface Data {
  days: number;
  totals: { opportunities: number; won: number; lost: number };
  stageStats: {
    stage: { id: string; label: string; color: string | null };
    medianDays: number | null;
    samples: number;
    lost: number;
    stale: number;
  }[];
  objections: { text: string; count: number; won: number; lost: number; open: number }[];
  meetingImpact: {
    withMeeting: { closed: number; winRate: number | null };
    withoutMeeting: { closed: number; winRate: number | null };
  };
  lossReasons: { reason: string; count: number }[];
  response: { conversations: number; medianMinutes: number | null; slowShare: number | null };
}

const LOSS_LABELS: Record<string, string> = {
  PRESUPUESTO: "Presupuesto",
  SIN_URGENCIA: "Sin urgencia",
  ELIGIO_COMPETENCIA: "Eligió a la competencia",
  NO_RESPONDIO: "No respondió",
  PROYECTO_CANCELADO: "Proyecto cancelado",
  NO_FIT: "No encaja",
  DECISION_POSTERGADA: "Decisión postergada",
  OTRO: "Otro",
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

function formatMinutes(m: number | null): string {
  if (m === null) return "—";
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} días`;
}

export function LearningClient() {
  const [days, setDays] = useState("90");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard/learning?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No se pudo cargar el análisis"))))
      .then((d: Data) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-muted">Oportunidades creadas en los últimos</span>
        <Select value={days} onChange={(e) => {
            setData(null);
            setError(null);
            setDays(e.target.value);
          }} className="w-32">
          <option value="30">30 días</option>
          <option value="90">90 días</option>
          <option value="180">180 días</option>
          <option value="365">365 días</option>
        </Select>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!data && !error && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={14} className="animate-spin" /> Calculando…
        </p>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardDescription>Primera respuesta humana (mediana)</CardDescription>
              <p className="mt-1 text-2xl font-semibold">{formatMinutes(data.response.medianMinutes)}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {data.response.slowShare === null
                  ? "Sin conversaciones respondidas por una persona."
                  : `${pct(data.response.slowShare)} tardó más de 1 hora (${data.response.conversations} conversaciones).`}
              </p>
            </Card>
            <Card>
              <CardDescription>Cierre con reunión</CardDescription>
              <p className="mt-1 text-2xl font-semibold">{pct(data.meetingImpact.withMeeting.winRate)}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {data.meetingImpact.withMeeting.closed} cerradas con reunión realizada
              </p>
            </Card>
            <Card>
              <CardDescription>Cierre sin reunión</CardDescription>
              <p className="mt-1 text-2xl font-semibold">{pct(data.meetingImpact.withoutMeeting.winRate)}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {data.meetingImpact.withoutMeeting.closed} cerradas sin reunión
              </p>
            </Card>
          </div>

          <Card>
            <CardTitle className="mb-1">Etapas: tiempo y dónde se atascan</CardTitle>
            <CardDescription className="mb-3">
              Mediana de días que una oportunidad pasa en cada etapa, leads perdidos que se cayeron en
              ella y abiertos sin cambios hace más de 14 días.
            </CardDescription>
            <Table>
              <Thead>
                <tr>
                  <Th>Etapa</Th>
                  <Th>Mediana</Th>
                  <Th>Perdidos aquí</Th>
                  <Th>Estancados</Th>
                </tr>
              </Thead>
              <tbody>
                {data.stageStats.map((s) => (
                  <Tr key={s.stage.id}>
                    <Td>{s.stage.label}</Td>
                    <Td>{s.medianDays === null ? "—" : `${s.medianDays} d (${s.samples})`}</Td>
                    <Td>{s.lost}</Td>
                    <Td>{s.stale}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle className="mb-1">Objeciones en reuniones</CardTitle>
              <CardDescription className="mb-3">
                Lo que más aparece en los resúmenes de reunión y cómo terminó cada oportunidad.
              </CardDescription>
              {data.objections.length === 0 ? (
                <p className="text-sm text-ink-muted">Todavía no hay objeciones registradas.</p>
              ) : (
                <ul className="space-y-2">
                  {data.objections.map((o) => (
                    <li key={o.text} className="text-sm">
                      <span className="text-ink">{o.text}</span>{" "}
                      <span className="text-xs text-ink-muted">
                        · {o.count} {o.count === 1 ? "vez" : "veces"} ({o.won} ganadas, {o.lost} perdidas,{" "}
                        {o.open} abiertas)
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardTitle className="mb-1">Razones de pérdida</CardTitle>
              <CardDescription className="mb-3">Por qué se cayeron las oportunidades.</CardDescription>
              {data.lossReasons.length === 0 ? (
                <p className="text-sm text-ink-muted">Sin pérdidas con motivo en este período.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.lossReasons.map((r) => (
                    <li key={r.reason} className="flex justify-between text-sm">
                      <span>{LOSS_LABELS[r.reason] ?? r.reason}</span>
                      <span className="text-ink-muted">{r.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
