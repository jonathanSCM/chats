"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Sparkles, AlertTriangle } from "lucide-react";
import { updateOpportunityFieldAction } from "@/server/actions/crm";
import { ALL_STAGES, STAGE_LABEL, STAGE_COLOR, PRIORITY_COLOR, type Stage } from "@/lib/pipeline";
import { vendorColor } from "@/lib/vendor-color";
import type { Row } from "./tracking-table";

function dateShort(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "2-digit" });
}

function leadScoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#3b82f6";
  if (score >= 40) return "#eab308";
  return "#71717a";
}

/** 🔴 vencido / 🟠 hoy / 🔵 mañana / fecha corta — mismo criterio que la tabla. */
function dueBadge(iso: string | null): { text: string; color: string } | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(iso.slice(0, 10) + "T00:00:00");
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) return { text: `Vencido (${-diffDays}d)`, color: "#dc2626" };
  if (diffDays === 0) return { text: "Hoy", color: "#ea580c" };
  if (diffDays === 1) return { text: "Mañana", color: "#2563eb" };
  return { text: dateShort(iso), color: "var(--color-ink-faint)" };
}

export function KanbanBoard({
  rows,
  currentUserId,
  isAdmin,
  onOpen,
}: {
  rows: Row[];
  currentUserId: string;
  isAdmin: boolean;
  onOpen: (row: Row) => void;
}) {
  const [isPending, startTransition] = useTransition();
  // Copia local para mover la tarjeta al instante al soltarla, sin esperar
  // la vuelta del servidor — mismo patrón que el orden manual de la tabla.
  const [localStage, setLocalStage] = useState<Record<string, Stage>>({});
  const dragIdRef = useRef<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Barra de scroll horizontal "espejo", pegada abajo de la pantalla —
  // mismo patrón que la tabla de Seguimiento: con muchas columnas de etapa
  // la barra nativa queda al final de las tarjetas, lejos de la vista si
  // hay que bajar mucho dentro de una columna.
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const mirrorScrollRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const syncingRef = useRef<"board" | "mirror" | null>(null);

  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    const measure = () => {
      setContentWidth(el.scrollWidth);
      setContainerWidth(el.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rows]);

  function handleBoardScroll() {
    if (syncingRef.current === "mirror") {
      syncingRef.current = null;
      return;
    }
    if (!boardScrollRef.current || !mirrorScrollRef.current) return;
    syncingRef.current = "board";
    mirrorScrollRef.current.scrollLeft = boardScrollRef.current.scrollLeft;
  }

  function handleMirrorScroll() {
    if (syncingRef.current === "board") {
      syncingRef.current = null;
      return;
    }
    if (!boardScrollRef.current || !mirrorScrollRef.current) return;
    syncingRef.current = "mirror";
    boardScrollRef.current.scrollLeft = mirrorScrollRef.current.scrollLeft;
  }

  function stageOf(row: Row): Stage {
    return localStage[row.id] ?? row.stage;
  }

  function canEdit(row: Row): boolean {
    return isAdmin || row.assignedTo?.id === currentUserId;
  }

  function handleDrop(stage: Stage) {
    setDragOverStage(null);
    const id = dragIdRef.current;
    dragIdRef.current = null;
    if (!id) return;

    const row = rows.find((r) => r.id === id);
    if (!row || !canEdit(row) || stageOf(row) === stage) return;

    const previousStage = stageOf(row);
    setLocalStage((prev) => ({ ...prev, [id]: stage }));
    setError(null);
    startTransition(async () => {
      const result = await updateOpportunityFieldAction(id, "stage", stage);
      if (result.error) {
        setLocalStage((prev) => ({ ...prev, [id]: previousStage }));
        setError(result.error);
      }
    });
  }

  return (
    <>
    {error && <p className="mb-2 text-xs text-danger">{error}</p>}
    <div ref={boardScrollRef} onScroll={handleBoardScroll} className="-mx-4 overflow-x-auto pb-2 md:-mx-8">
      <div className="flex min-w-max gap-3 px-4 md:px-8">
        {ALL_STAGES.map((stage) => {
          const cards = rows.filter((r) => stageOf(r) === stage);
          return (
            <div
              key={stage}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStage(stage);
              }}
              onDragLeave={() => setDragOverStage((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(stage);
              }}
              className={`flex w-64 shrink-0 flex-col rounded-lg border bg-surface-2/40 transition-colors ${
                dragOverStage === stage ? "border-accent-dim bg-accent/5" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: STAGE_COLOR[stage] }}
                />
                <p className="flex-1 truncate font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  {STAGE_LABEL[stage]}
                </p>
                <span className="font-mono text-[11px] text-ink-faint">{cards.length}</span>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-2" style={{ minHeight: 120 }}>
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
                      className={`block w-full rounded-md border border-border bg-surface p-2.5 text-left text-xs transition-colors hover:border-accent-dim ${
                        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                      }`}
                    >
                      <p className="truncate font-medium text-ink">{row.client || row.phone}</p>
                      {row.service && <p className="mt-0.5 truncate text-[11px] text-ink-faint">{row.service}</p>}

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {row.priority && (
                          <span
                            className="rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase"
                            style={{
                              color: PRIORITY_COLOR[row.priority],
                              backgroundColor: `${PRIORITY_COLOR[row.priority]}1a`,
                            }}
                          >
                            {row.priority}
                          </span>
                        )}
                        {row.leadScore !== null && (
                          <span
                            className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold"
                            style={{
                              color: leadScoreColor(row.leadScore),
                              backgroundColor: `${leadScoreColor(row.leadScore)}1a`,
                            }}
                          >
                            <Sparkles size={9} /> {row.leadScore}
                          </span>
                        )}
                      </div>

                      {row.nextAction && row.nextActionAt ? (
                        <p className="mt-1.5 flex items-center gap-1 truncate text-[10px] text-ink-muted">
                          📅 {row.nextAction}
                          {(() => {
                            const badge = dueBadge(row.nextActionAt);
                            return (
                              badge && (
                                <span className="font-semibold" style={{ color: badge.color }}>
                                  {badge.text}
                                </span>
                              )
                            );
                          })()}
                        </p>
                      ) : (
                        <p className="mt-1.5 flex items-center gap-1 text-[10px] text-warning">
                          <AlertTriangle size={9} /> Sin próxima acción
                        </p>
                      )}

                      {row.assignedTo && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <span
                            className="h-4 w-4 shrink-0 rounded-full text-center font-mono text-[8px] font-semibold leading-4 text-white"
                            style={{ backgroundColor: vendorColor(row.assignedTo.id, row.assignedTo.color) }}
                          >
                            {row.assignedTo.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="truncate text-[10px] text-ink-faint">
                            {row.assignedTo.id === currentUserId ? "Tú" : row.assignedTo.name}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
                {cards.length === 0 && (
                  <p className="px-1 py-4 text-center text-[11px] text-ink-faint">Sin clientes acá.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>

    {contentWidth > containerWidth && (
      <div
        ref={mirrorScrollRef}
        onScroll={handleMirrorScroll}
        className="sticky bottom-0 z-20 -mx-4 overflow-x-auto overflow-y-hidden border-t border-border bg-surface md:-mx-8"
        style={{ height: 16 }}
      >
        <div style={{ width: contentWidth, height: 1 }} />
      </div>
    )}
    </>
  );
}
