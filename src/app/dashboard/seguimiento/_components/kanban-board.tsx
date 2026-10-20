"use client";

import { DUE_COLOR, leadScoreColor } from "@/lib/status-colors";
import { useRef, useState, useTransition } from "react";
import { Sparkles, AlertTriangle, Bell, CalendarDays, User } from "lucide-react";
import { updateOpportunityFieldAction } from "@/server/actions/crm";
import { PRIORITY_COLOR, hasCompleteNextAction, missingForStage } from "@/lib/pipeline";
import { vendorColor } from "@/lib/vendor-color";
import { deriveAlerts, urgencyRank } from "@/lib/opportunity-alerts";
import type { Row } from "./tracking-table";
import type { PipelineStage } from "@/server/services/pipeline";

/** Iniciales para el avatar de la tarjeta (máximo dos letras). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[1][0] : "")).toUpperCase() || "?";
}

function dateShort(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "2-digit" });
}

/** 🔴 vencido / 🟠 hoy / 🔵 mañana / fecha corta — mismo criterio que la tabla. */
function dueBadge(iso: string | null): { text: string; color: string } | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(iso.slice(0, 10) + "T00:00:00");
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) return { text: `Vencido (${-diffDays}d)`, color: DUE_COLOR.overdue };
  if (diffDays === 0) return { text: "Hoy", color: DUE_COLOR.today };
  if (diffDays === 1) return { text: "Mañana", color: DUE_COLOR.tomorrow };
  return { text: dateShort(iso), color: "var(--color-ink-faint)" };
}

export function KanbanBoard({
  rows,
  stages,
  currentUserId,
  isAdmin,
  onOpen,
}: {
  rows: Row[];
  /** Etapas de la organización, ordenadas — cada una es una columna. */
  stages: PipelineStage[];
  currentUserId: string;
  isAdmin: boolean;
  onOpen: (row: Row) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const todayStr = new Date().toISOString().slice(0, 10);
  // Copia local para mover la tarjeta al instante al soltarla, sin esperar
  // la vuelta del servidor — mismo patrón que el orden manual de la tabla.
  // Guarda el id de la PipelineStage destino.
  const [localStage, setLocalStage] = useState<Record<string, string>>({});
  const dragIdRef = useRef<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // El tablero se arrastra con el botón IZQUIERDO del mouse -- pedido así a
  // propósito, aunque puede chocar con el drag nativo de las tarjetas
  // (mover de etapa) si se agarra justo desde una tarjeta: para minimizar
  // eso, el pan no arranca si el mousedown fue sobre una tarjeta.
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const el = boardScrollRef.current;
    if (!el) return;
    panRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft };
    setIsPanning(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    const el = boardScrollRef.current;
    if (!pan || !el) return;
    el.scrollLeft = pan.startScrollLeft - (e.clientX - pan.startX);
  }

  function endPan() {
    panRef.current = null;
    setIsPanning(false);
  }

  function stageIdOf(row: Row): string {
    return localStage[row.id] ?? row.stage.id;
  }

  function canEdit(row: Row): boolean {
    return isAdmin || row.assignedTo?.id === currentUserId;
  }

  function handleDrop(stageId: string) {
    setDragOverStage(null);
    const id = dragIdRef.current;
    dragIdRef.current = null;
    if (!id) return;

    const row = rows.find((r) => r.id === id);
    if (!row || !canEdit(row) || stageIdOf(row) === stageId) return;

    const targetStage = stages.find((s) => s.id === stageId);
    const missing = missingForStage(targetStage?.requiresProposalFields ?? false, row);
    if (
      missing.length > 0 &&
      !window.confirm(`Todavía falta ${missing.join(", ")}. ¿Deseas avanzar igualmente?`)
    ) {
      return;
    }

    const previousStageId = stageIdOf(row);
    setLocalStage((prev) => ({ ...prev, [id]: stageId }));
    setError(null);
    startTransition(async () => {
      const result = await updateOpportunityFieldAction(id, "stage", stageId);
      if (result.error) {
        setLocalStage((prev) => ({ ...prev, [id]: previousStageId }));
        setError(result.error);
      }
    });
  }

  return (
    <>
    {error && <p className="mb-2 text-xs text-danger">{error}</p>}
    <div
      ref={boardScrollRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerLeave={endPan}
      className={`-mx-4 overflow-x-auto pb-3 md:-mx-6 ${
        isPanning ? "cursor-grabbing select-none" : "cursor-grab"
      }`}
    >
      <div className="flex min-w-max gap-3 px-4 md:px-6">
        {stages.map((stage) => {
          // Los vencidos suben solos arriba dentro de cada etapa (scope §9).
          const cards = rows
            .filter((r) => stageIdOf(r) === stage.id)
            .sort((a, b) => {
              const ra = urgencyRank(a, todayStr);
              const rb = urgencyRank(b, todayStr);
              for (let i = 0; i < ra.length; i++) {
                if (ra[i] !== rb[i]) return ra[i] - rb[i];
              }
              return 0;
            });
          return (
            <div
              key={stage.id}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStage(stage.id);
              }}
              onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(stage.id);
              }}
              className={`flex w-[280px] shrink-0 flex-col rounded-xl border bg-surface-2/60 transition-colors duration-[180ms] ${
                dragOverStage === stage.id ? "border-accent bg-accent/5" : "border-border"
              }`}
            >
              <div
                className="flex items-center gap-2 rounded-t-xl border-b border-border px-3.5 py-3"
                style={{ boxShadow: `inset 0 3px 0 ${stage.color}` }}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                <p className="flex-1 truncate text-sm font-semibold text-ink lowercase first-letter:uppercase" title={stage.criteria}>
                  {stage.label}
                </p>
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-border">
                  {cards.length}
                </span>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-3" style={{ minHeight: 120, maxHeight: "calc(100vh - 260px)" }}>
                {cards.map((row) => {
                  const draggable = canEdit(row);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      draggable={draggable}
                      onDragStart={() => {
                        dragIdRef.current = row.id;
                      }}
                      onClick={() => onOpen(row)}
                      disabled={isPending}
                      className={`block w-full rounded-lg border border-border bg-surface p-3 text-left text-[13px] shadow-sm transition-colors duration-[180ms] hover:border-accent/60 ${
                        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                      }`}
                    >
                      {/* Identidad del cliente */}
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#8b5cf6]/12 text-xs font-semibold text-[#8b5cf6]">
                          {initials(row.client || row.phone)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                            <span className="truncate">{row.client || row.phone}</span>
                            {(() => {
                              const alert = deriveAlerts(row, todayStr);
                              return (
                                alert.reasons.length > 0 && (
                                  <span title={alert.reasons.join(" · ")} className="shrink-0">
                                    <Bell size={13} className={alert.severity === "alta" ? "text-danger" : "text-warning"} />
                                  </span>
                                )
                              );
                            })()}
                          </p>
                          {row.service && <p className="truncate text-xs text-ink-muted">{row.service}</p>}
                        </div>
                      </div>

                      {/* Prioridad y calificación */}
                      {(row.priority || row.leadScore !== null) && (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {row.priority && (
                            <span
                              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                              style={{
                                color: PRIORITY_COLOR[row.priority],
                                backgroundColor: `${PRIORITY_COLOR[row.priority]}1a`,
                              }}
                            >
                              {row.priority[0] + row.priority.slice(1).toLowerCase()}
                            </span>
                          )}
                          {row.leadScore !== null && (
                            <span
                              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                              style={{
                                color: leadScoreColor(row.leadScore),
                                backgroundColor: `${leadScoreColor(row.leadScore)}1a`,
                              }}
                            >
                              <Sparkles size={12} /> {row.leadScore}/100
                            </span>
                          )}
                        </div>
                      )}

                      {/* Próxima acción */}
                      {hasCompleteNextAction(row) ? (
                        <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-muted">
                          <CalendarDays size={14} className="shrink-0 text-ink-faint" />
                          <span className="truncate">{row.nextAction}</span>
                        </p>
                      ) : (
                        <p className="mt-3 flex items-center gap-2 text-xs font-medium text-warning">
                          <AlertTriangle size={14} className="shrink-0" />
                          {row.nextAction && row.nextActionAt ? "Sin responsable asignado" : "Sin próxima acción"}
                        </p>
                      )}

                      {/* Plazo y responsable */}
                      {(() => {
                        const badge = hasCompleteNextAction(row) ? dueBadge(row.nextActionAt) : null;
                        if (!badge && !row.assignedTo) return null;
                        return (
                          <div className="mt-3 flex items-center justify-between gap-2">
                            {badge ? (
                              <span
                                className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                                style={{ color: badge.color, backgroundColor: `color-mix(in srgb, ${badge.color} 12%, transparent)` }}
                              >
                                {badge.text}
                              </span>
                            ) : (
                              <span />
                            )}
                            {row.assignedTo && (
                              <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
                                <User size={13} className="shrink-0" style={{ color: vendorColor(row.assignedTo.id, row.assignedTo.color) }} />
                                <span className="truncate">{row.assignedTo.id === currentUserId ? "Tú" : row.assignedTo.name}</span>
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </button>
                  );
                })}
                {cards.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-ink-faint">Sin clientes acá.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}
