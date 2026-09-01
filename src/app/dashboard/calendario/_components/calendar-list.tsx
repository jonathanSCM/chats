"use client";

import Link from "next/link";
import { CalendarDays, Clock, Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { vendorColor } from "@/lib/vendor-color";

export interface MeetingRow {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  meetingUrl: string | null;
  status: string;
  opportunityId: string | null;
  client: string;
  service: string;
  need: string;
  assignedTo: { id: string; name: string; color: string | null } | null;
}

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Agendada",
  CONFIRMED: "Confirmada",
  DONE: "Realizada",
  CANCELED: "Cancelada",
  NO_SHOW: "No se presentó",
};

/** Mismo criterio de urgencia que ya usa Seguimiento para "próxima acción". */
function dayLabel(iso: string): { text: string; color: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(iso);
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((dateOnly.getTime() - today.getTime()) / 86_400_000);

  if (diffDays === 0) return { text: "Hoy", color: "#ea580c" };
  if (diffDays === 1) return { text: "Mañana", color: "#2563eb" };
  if (diffDays === -1) return { text: "Ayer", color: "var(--color-ink-faint)" };
  if (diffDays < 0) return { text: `Hace ${-diffDays} días`, color: "var(--color-ink-faint)" };
  return {
    text: date.toLocaleDateString("es", { weekday: "long", day: "2-digit", month: "2-digit" }),
    color: "var(--color-ink-faint)",
  };
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export function CalendarList({ rows }: { rows: MeetingRow[] }) {
  // Agrupa por día para que se lea como una agenda, no como una tabla plana.
  const groups = new Map<string, MeetingRow[]>();
  for (const r of rows) {
    const key = r.scheduledAt.slice(0, 10);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 && (
        <Card className="text-sm text-ink-muted">
          No hay reuniones agendadas este mes. Se agendan desde la ficha de una oportunidad en
          Seguimiento.
        </Card>
      )}

      {[...groups.entries()].map(([dateKey, dayRows]) => {
        const { text: label, color } = dayLabel(dayRows[0].scheduledAt);
        return (
          <div key={dateKey} className="space-y-2">
            <p
              className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide"
              style={{ color }}
            >
              <CalendarDays size={12} /> {label}
            </p>
            <div className="space-y-2">
              {dayRows.map((m) => (
                <MeetingCard key={m.id} m={m} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MeetingCard({ m }: { m: MeetingRow }) {
  return (
    <Card className="flex flex-wrap items-center gap-3 py-3">
      <div className="flex w-16 shrink-0 items-center gap-1 font-mono text-sm text-ink">
        <Clock size={13} className="text-ink-faint" /> {timeLabel(m.scheduledAt)}
      </div>

      <div className="min-w-0 flex-1">
        <Link
          href={m.opportunityId ? `/dashboard/seguimiento?open=${m.opportunityId}` : "/dashboard/seguimiento"}
          className="truncate font-medium text-ink hover:text-accent"
        >
          {m.client}
        </Link>
        <p className="truncate text-xs text-ink-faint">
          {[m.service, m.need].filter(Boolean).join(" · ") || "Sin descripción"}
        </p>
      </div>

      <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-muted">
        {STATUS_LABEL[m.status] ?? m.status}
      </span>

      {m.assignedTo && (
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
          style={{ backgroundColor: vendorColor(m.assignedTo.id, m.assignedTo.color) }}
          title={m.assignedTo.name}
        >
          {m.assignedTo.name.slice(0, 1).toUpperCase()}
        </span>
      )}

      {m.meetingUrl && (
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(m.meetingUrl!)}
          title="Copiar link de la reunión"
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-ink-muted hover:border-accent-dim hover:text-accent"
        >
          <Copy size={11} /> Link
        </button>
      )}
    </Card>
  );
}
