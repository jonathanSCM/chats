"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarDays, List, LayoutGrid, X, Clock, Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { vendorColor } from "@/lib/vendor-color";
import { CalendarList, type MeetingRow } from "./calendar-list";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// Siempre en horario LOCAL — nunca .toISOString() acá. Mezclar UTC con
// getters locales (getDate/getMonth) es justo lo que hacía que "hoy"
// resaltara el día equivocado cuando el navegador está en un huso
// distinto al servidor.
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "YYYY-MM-DD" a Date sin ambigüedad de huso: new Date("2026-09-01") a
// secas lo interpreta como UTC (spec de ECMAScript) — agregar la hora
// fuerza a que el motor lo lea en horario local, coherente con dateKey.
function parseYmd(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Agendada",
  CONFIRMED: "Confirmada",
  DONE: "Realizada",
  CANCELED: "Cancelada",
  NO_SHOW: "No se presentó",
};

const MAX_VISIBLE_PER_DAY = 3;

export function CalendarMonth({
  rows,
  gridStart,
  gridEndInclusive,
  monthStart,
  monthLabel,
  prevHref,
  nextHref,
  todayHref,
}: {
  rows: MeetingRow[];
  gridStart: string;
  gridEndInclusive: string;
  monthStart: string;
  monthEnd: string;
  monthLabel: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
}) {
  const [view, setView] = useState<"mes" | "agenda">("mes");
  const [dayDetail, setDayDetail] = useState<string | null>(null);

  const byDay = new Map<string, MeetingRow[]>();
  for (const r of rows) {
    const key = dateKey(new Date(r.scheduledAt));
    const list = byDay.get(key) ?? [];
    list.push(r);
    byDay.set(key, list);
  }

  const days: Date[] = [];
  const cursor = parseYmd(gridStart);
  const end = parseYmd(gridEndInclusive);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const todayKey = dateKey(new Date());
  const currentMonth = parseYmd(monthStart).getMonth();
  const detailRows = dayDetail ? (byDay.get(dayDetail) ?? []) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={prevHref}
            aria-label="Mes anterior"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-ink-muted hover:border-accent-dim hover:text-accent"
          >
            <ChevronLeft size={15} />
          </Link>
          <p className="w-40 text-center font-display text-base font-semibold capitalize">{monthLabel}</p>
          <Link
            href={nextHref}
            aria-label="Mes siguiente"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-ink-muted hover:border-accent-dim hover:text-accent"
          >
            <ChevronRight size={15} />
          </Link>
          <Link
            href={todayHref}
            className="ml-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-ink-muted hover:border-accent-dim hover:text-accent"
          >
            Hoy
          </Link>
        </div>

        <div className="flex items-center rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => setView("mes")}
            title="Vista de mes"
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              view === "mes" ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            <LayoutGrid size={13} />
          </button>
          <button
            type="button"
            onClick={() => setView("agenda")}
            title="Vista de agenda"
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              view === "agenda" ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            <List size={13} />
          </button>
        </div>
      </div>

      {view === "agenda" ? (
        <CalendarList rows={rows} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-7 border-b border-border bg-surface-2/60">
            {WEEKDAY_LABELS.map((d, i) => (
              <div
                key={d}
                className={`px-2 py-2 text-center font-mono text-[10px] uppercase tracking-wide text-ink-faint ${
                  i >= 5 ? "text-ink-faint/70" : ""
                }`}
              >
                {d}
              </div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-border last:border-b-0">
              {week.map((d) => {
                const key = dateKey(d);
                const isToday = key === todayKey;
                const inMonth = d.getMonth() === currentMonth;
                const dayMeetings = byDay.get(key) ?? [];
                const visible = dayMeetings.slice(0, MAX_VISIBLE_PER_DAY);
                const overflow = dayMeetings.length - visible.length;
                return (
                  <div
                    key={key}
                    className={`min-h-[86px] border-r border-border p-1.5 last:border-r-0 ${
                      inMonth ? "bg-surface" : "bg-surface-2/30"
                    }`}
                  >
                    <span
                      className={`mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[11px] ${
                        isToday
                          ? "bg-accent font-semibold text-accent-ink"
                          : inMonth
                            ? "text-ink-muted"
                            : "text-ink-faint/60"
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    <div className="space-y-0.5">
                      {visible.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setDayDetail(key)}
                          title={`${timeLabel(m.scheduledAt)} · ${m.client}`}
                          className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] hover:bg-surface-2"
                          style={{ backgroundColor: `${vendorColor(m.assignedTo?.id ?? "sin-asignar", m.assignedTo?.color)}1a` }}
                        >
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: vendorColor(m.assignedTo?.id ?? "sin-asignar", m.assignedTo?.color) }}
                          />
                          <span className="shrink-0 font-mono text-ink-faint">{timeLabel(m.scheduledAt)}</span>
                          <span className="truncate text-ink-muted">{m.client}</span>
                        </button>
                      ))}
                      {overflow > 0 && (
                        <button
                          type="button"
                          onClick={() => setDayDetail(key)}
                          className="w-full rounded px-1 py-0.5 text-left text-[10px] text-ink-faint hover:text-accent"
                        >
                          +{overflow} más
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {dayDetail && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => setDayDetail(null)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <aside className="relative flex w-full max-w-sm flex-col overflow-y-auto border-l border-border bg-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 font-display text-base font-semibold">
                <CalendarDays size={15} />
                {parseYmd(dayDetail).toLocaleDateString("es", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                })}
              </h2>
              <button type="button" onClick={() => setDayDetail(null)} className="cursor-pointer text-ink-faint hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2">
              {detailRows.map((m) => (
                <Card key={m.id} className="py-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="flex items-center gap-1 font-mono text-sm text-ink">
                      <Clock size={12} className="text-ink-faint" /> {timeLabel(m.scheduledAt)}
                    </span>
                    <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                      {STATUS_LABEL[m.status] ?? m.status}
                    </span>
                  </div>
                  <Link
                    href={
                      m.opportunityId
                        ? `/dashboard/seguimiento?open=${m.opportunityId}`
                        : m.isInternal
                          ? "/dashboard/reuniones"
                          : "/dashboard/seguimiento"
                    }
                    className="font-medium text-ink hover:text-accent"
                  >
                    {m.client}
                  </Link>
                  {m.isInternal && (
                    <span className="ml-1 rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase text-ink-faint">
                      Interna
                    </span>
                  )}
                  <p className="text-xs text-ink-faint">
                    {[m.service, m.need].filter(Boolean).join(" · ") || "Sin descripción"}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    {m.assignedTo && (
                      <span className="flex items-center gap-1 text-[11px] text-ink-muted">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: vendorColor(m.assignedTo.id, m.assignedTo.color) }}
                        />
                        {m.assignedTo.name}
                      </span>
                    )}
                    {m.meetingUrl && (
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(m.meetingUrl!)}
                        title="Copiar link de la reunión"
                        className="ml-auto flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-ink-muted hover:border-accent-dim hover:text-accent"
                      >
                        <Copy size={11} /> Link
                      </button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
