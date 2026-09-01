"use client";

import Link from "next/link";
import { TrendingUp, TrendingDown, CalendarDays, Sparkles } from "lucide-react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { STAGE_LABEL, STAGE_COLOR, OPEN_STAGES, type Stage } from "@/lib/pipeline";
import { vendorColor } from "@/lib/vendor-color";

interface UpcomingMeeting {
  id: string;
  scheduledAt: string;
  opportunityId: string | null;
  client: string;
  assignedTo: { id: string; name: string; color: string | null } | null;
}

// Datos de ejemplo — a propósito, hasta que se conecte a las métricas
// reales. Los colores/etiquetas de etapa sí son los reales de
// `@/lib/pipeline`, para que el look ya quede alineado.
const FAKE_KPIS = [
  { label: "Conversaciones esta semana", value: "142", delta: "+12%", up: true },
  { label: "Oportunidades activas", value: "38", delta: "+4%", up: true },
  { label: "Valor en el pipeline", value: "US$ 24.500", delta: "+8%", up: true },
  { label: "Tasa de respuesta", value: "68%", delta: "-3%", up: false },
];

const FAKE_STAGE_COUNTS: Partial<Record<Stage, number>> = {
  POR_CALIFICAR: 18,
  ENTREVISTA: 9,
  DIAGNOSTICO: 5,
  PRESENTAR_SOLUCION: 4,
  PROPUESTA: 3,
  DECISION: 2,
  GANADO: 6,
};

const FAKE_MESSAGES_PER_DAY = [
  { day: "Lun", value: 42 },
  { day: "Mar", value: 55 },
  { day: "Mié", value: 38 },
  { day: "Jue", value: 61 },
  { day: "Vie", value: 49 },
  { day: "Sáb", value: 21 },
  { day: "Dom", value: 12 },
];

function PreviewChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-accent">
      <Sparkles size={10} /> Vista previa · datos de ejemplo
    </span>
  );
}

function StageDonut({ counts }: { counts: Partial<Record<Stage, number>> }) {
  const stages = [...OPEN_STAGES, "GANADO"] as Stage[];
  const total = stages.reduce((sum, s) => sum + (counts[s] ?? 0), 0) || 1;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-surface-2)" strokeWidth="14" />
        {stages.map((s) => {
          const value = counts[s] ?? 0;
          if (value === 0) return null;
          const length = (value / total) * circumference;
          const dasharray = `${length} ${circumference - length}`;
          const circle = (
            <circle
              key={s}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={STAGE_COLOR[s]}
              strokeWidth="14"
              strokeDasharray={dasharray}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return circle;
        })}
      </svg>
      <div className="grid grid-cols-1 gap-1.5">
        {stages
          .filter((s) => (counts[s] ?? 0) > 0)
          .map((s) => (
            <div key={s} className="flex items-center gap-1.5 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: STAGE_COLOR[s] }} />
              <span className="text-ink-muted">{STAGE_LABEL[s]}</span>
              <span className="ml-auto font-mono text-ink-faint">{counts[s]}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function MessagesBarChart({ data }: { data: { day: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const chartHeight = 90;
  return (
    <div className="flex items-end gap-2.5" style={{ height: chartHeight + 22 }}>
      {data.map((d) => (
        <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1.5">
          <div
            className="w-full rounded-t bg-accent/70"
            style={{ height: Math.max(6, (d.value / max) * chartHeight) }}
          />
          <span className="font-mono text-[10px] text-ink-faint">{d.day}</span>
        </div>
      ))}
    </div>
  );
}

export function DashboardPreview({
  userName,
  upcomingMeetings,
}: {
  userName: string;
  upcomingMeetings: UpcomingMeeting[];
}) {
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

      <div>
        <div className="mb-2 flex items-center gap-2">
          <p className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">Resumen</p>
          <PreviewChip />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {FAKE_KPIS.map((k) => (
            <Card key={k.label} className="py-3">
              <CardDescription className="mb-1 font-mono text-[11px] uppercase tracking-wide">
                {k.label}
              </CardDescription>
              <div className="flex items-baseline gap-2">
                <CardTitle className="font-mono text-xl">{k.value}</CardTitle>
                <span
                  className="flex items-center gap-0.5 font-mono text-[11px] font-semibold"
                  style={{ color: k.up ? STAGE_COLOR.GANADO : "var(--color-danger)" }}
                >
                  {k.up ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {k.delta}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <CardTitle className="text-sm">Distribución del pipeline</CardTitle>
            <PreviewChip />
          </div>
          <StageDonut counts={FAKE_STAGE_COUNTS} />
        </Card>

        <Card>
          <div className="mb-3 flex items-center gap-2">
            <CardTitle className="text-sm">Mensajes por día</CardTitle>
            <PreviewChip />
          </div>
          <MessagesBarChart data={FAKE_MESSAGES_PER_DAY} />
        </Card>
      </div>

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
