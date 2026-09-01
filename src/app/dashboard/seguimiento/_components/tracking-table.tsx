"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Plus,
  X,
  Copy,
  Check,
  Trash2,
  Sparkles,
  Loader2,
  Video,
  Archive,
  ArchiveRestore,
  GripVertical,
  ArrowUp,
  ArrowDown,
  LayoutGrid,
  Table2,
  Paperclip,
  FileText,
  AlertTriangle,
  Eye,
} from "lucide-react";
import {
  createOpportunityAction,
  updateOpportunityFieldAction,
  deleteOpportunityAction,
  analyzeOpportunityAction,
  archiveOpportunityAction,
  unarchiveOpportunityAction,
  reorderOpportunitiesAction,
  createMeetingAction,
  updateMeetingNotesAction,
  deleteMeetingAction,
  addMeetingAttachmentAction,
  deleteMeetingAttachmentAction,
} from "@/server/actions/crm";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import {
  ALL_STAGES,
  STAGE_LABEL,
  STAGE_COLOR,
  PRIORITY_COLOR,
  SERVICES,
  isOpenStage,
  type Stage,
  type Priority,
} from "@/lib/pipeline";
import { vendorColor } from "@/lib/vendor-color";
import { KanbanBoard } from "./kanban-board";

export interface MeetingAttachmentInfo {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface Row {
  id: string;
  registeredAt: string;
  client: string;
  phone: string;
  city: string;
  service: string;
  need: string;
  stage: Stage;
  lastUpdate: string;
  priority: Priority | null;
  nextContactAt: string | null;
  nextAction: string;
  nextActionAt: string | null;
  probability: number | null;
  aiRecommendation: string;
  aiSuggestedMessage: string;
  aiMemory: string;
  leadScore: number | null;
  leadScoreBreakdown: Record<string, number> | null;
  leadScoreCoverage: number | null;
  aiPainPoint: string;
  aiMissingInfo: string;
  aiNextQuestion: string;
  aiAlerts: string;
  meetings: {
    id: string;
    scheduledAt: string;
    status: string;
    notes: string;
    attachments: MeetingAttachmentInfo[];
  }[];
  archived: boolean;
  sortOrder: number;
  assignedTo: { id: string; name: string; color: string | null } | null;
  lostReason: string;
}

const LEAD_SCORE_BREAKDOWN_LABEL: Record<string, [string, number]> = {
  empresa_en_marcha: ["Empresa en marcha", 20],
  dolor_concreto: ["Dolor concreto", 20],
  impacto: ["Impacto", 15],
  decisor: ["Decisor", 15],
  capacidad_inversion: ["Capacidad de inversión", 15],
  encaje_proshop: ["Encaje", 10],
  urgencia: ["Urgencia", 5],
};

function leadScoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#3b82f6";
  if (score >= 40) return "#eab308";
  return "#71717a";
}

function leadScoreLabel(score: number): string {
  if (score >= 80) return "Oportunidad alta";
  if (score >= 60) return "Lead calificado";
  if (score >= 40) return "En exploración";
  return "Baja prioridad";
}

interface Member {
  id: string;
  name: string;
  color: string | null;
}

interface Props {
  rows: Row[];
  contacts: { id: string; label: string }[];
  members: Member[];
  currentUserId: string;
  isAdmin: boolean;
  viewingArchived: boolean;
  /** `?estado=todos` — muestra también Ganado/Perdido/En pausa (ocultos por defecto). */
  viewingAllStages: boolean;
  /** Si viene de `?open=<id>` (ej. desde el botón del inbox), abre ese cliente ni bien carga. */
  openId?: string;
  summary: {
    activeCount: number;
    overdueCount: number;
    highPriorityCount: number;
    noNextActionCount: number;
  };
  ai: { spent: number; budget: number; enabled: boolean };
}

type QuickFilter = "hoy" | "vencidos" | "semana" | "alta" | "sin_accion" | null;

/** 🔴 vencido / 🟠 hoy / 🔵 mañana / fecha corta — para que el vencimiento salte a la vista. */
function dueBadge(iso: string | null): { text: string; color: string } | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(iso.slice(0, 10) + "T00:00:00");
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86_400_000);

  if (diffDays < 0) {
    return { text: `Vencido hace ${-diffDays} día${-diffDays === 1 ? "" : "s"}`, color: "#dc2626" };
  }
  if (diffDays === 0) return { text: "Hoy", color: "#ea580c" };
  if (diffDays === 1) return { text: "Mañana", color: "#2563eb" };
  return { text: dateShort(iso), color: "var(--color-ink-faint)" };
}

type SortField =
  | "registeredAt"
  | "client"
  | "stage"
  | "leadScore"
  | "priority"
  | "nextContactAt"
  | "probability";

const PRIORITY_RANK: Record<string, number> = { ALTA: 3, MEDIA: 2, BAJA: 1 };

function sortValue(row: Row, field: SortField): number | string {
  switch (field) {
    case "registeredAt":
      return row.registeredAt;
    case "client":
      return row.client.toLowerCase();
    case "stage":
      return row.stage;
    case "leadScore":
      return row.leadScore ?? -1;
    case "priority":
      return row.priority ? PRIORITY_RANK[row.priority] : -1;
    case "nextContactAt":
      return row.nextContactAt ?? "";
    case "probability":
      return row.probability ?? -1;
  }
}

/** El admin puede todo; un vendedor solo lo que tiene asignado (o nadie lo tiene). */
function canEdit(row: Row, currentUserId: string, isAdmin: boolean): boolean {
  return isAdmin || row.assignedTo?.id === currentUserId;
}

/** Versión corta para la tabla, donde cada píxel de ancho cuenta. */
function dateShort(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function dateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function TrackingTable({
  rows,
  contacts,
  members,
  currentUserId,
  isAdmin,
  viewingArchived,
  viewingAllStages,
  openId,
  summary,
  ai,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [boardView, setBoardView] = useState<"table" | "kanban">("table");

  // Barra de scroll horizontal "espejo", pegada abajo de la pantalla: la
  // tabla puede tener muchas filas, y la barra nativa del navegador queda
  // al final de todo ese contenido — lejos de la vista si hay que bajar
  // mucho. Esta barra angosta sincroniza su scrollLeft con la tabla real.
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const mirrorScrollRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const syncingRef = useRef<"table" | "mirror" | null>(null);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el || boardView !== "table") return;
    const measure = () => {
      setContentWidth(el.scrollWidth);
      setContainerWidth(el.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [boardView]);
  const [detail, setDetail] = useState<Row | null>(null);
  // `detail` es una foto fija tomada al abrir la ficha — si el servidor
  // revalida `rows` mientras está abierta (ej. al guardar una reunión), hay
  // que refrescarla con los datos nuevos o la ficha se queda mostrando lo
  // viejo aunque el guardado haya funcionado.
  if (detail) {
    const fresh = rows.find((r) => r.id === detail.id);
    if (fresh && fresh !== detail) setDetail(fresh);
  }
  const [openedFromLink, setOpenedFromLink] = useState(false);
  if (openId && !openedFromLink) {
    const match = rows.find((r) => r.id === openId);
    if (match) {
      setOpenedFromLink(true);
      setDetail(match);
    }
  }
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<Stage | "">("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "">("");
  // Filtra por "Próximo contacto" — es el campo de fecha que de verdad usa
  // el equipo para planear el día, más que la fecha de registro.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  // Chips rápidos sobre la fecha de PRÓXIMA ACCIÓN (nextActionAt) — distinto
  // del rango de "próximo contacto" de arriba, que es el campo viejo.
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Orden manual (arrastrar y soltar): copia local para poder mover filas
  // al instante, sin esperar la vuelta del servidor. Se resincroniza cuando
  // cambian las filas de verdad (otro cambio, u otra persona reordenó).
  const [orderedRows, setOrderedRows] = useState(rows);
  const [syncedRows, setSyncedRows] = useState(rows);
  if (rows !== syncedRows) {
    setSyncedRows(rows);
    setOrderedRows(rows);
  }
  const dragIdRef = useRef<string | null>(null);

  const closeCreate = useCallback(() => setCreating(false), []);
  const closeDetail = useCallback(() => setDetail(null), []);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function clearSort() {
    setSortField(null);
  }

  function handleTableScroll() {
    if (syncingRef.current === "mirror") {
      syncingRef.current = null;
      return;
    }
    if (!tableScrollRef.current || !mirrorScrollRef.current) return;
    syncingRef.current = "table";
    mirrorScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
  }

  function handleMirrorScroll() {
    if (syncingRef.current === "table") {
      syncingRef.current = null;
      return;
    }
    if (!tableScrollRef.current || !mirrorScrollRef.current) return;
    syncingRef.current = "mirror";
    tableScrollRef.current.scrollLeft = mirrorScrollRef.current.scrollLeft;
  }

  function handleDrop(targetId: string) {
    const draggedId = dragIdRef.current;
    dragIdRef.current = null;
    if (!draggedId || draggedId === targetId) return;

    const next = orderedRows.slice();
    const from = next.findIndex((r) => r.id === draggedId);
    const to = next.findIndex((r) => r.id === targetId);
    if (from === -1 || to === -1) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    setOrderedRows(next);
    reorderOpportunitiesAction(next.map((r) => r.id));
  }

  const hasActiveFilter =
    Boolean(stageFilter) ||
    Boolean(priorityFilter) ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(assigneeFilter) ||
    Boolean(serviceFilter) ||
    Boolean(quickFilter);
  const canDrag = !sortField && !query.trim() && !hasActiveFilter && !viewingArchived;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekAheadStr = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

  const filtered = orderedRows
    .filter((r) => {
      if (stageFilter && r.stage !== stageFilter) return false;
      if (priorityFilter && r.priority !== priorityFilter) return false;
      if (assigneeFilter && r.assignedTo?.id !== assigneeFilter) return false;
      if (serviceFilter && r.service !== serviceFilter) return false;
      if (dateFrom || dateTo) {
        if (!r.nextContactAt) return false;
        const d = r.nextContactAt.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
      }
      if (quickFilter) {
        const d = r.nextActionAt?.slice(0, 10) ?? null;
        // "alta"/"vencidos"/"sin_accion" reflejan los KPIs de la cabecera,
        // que el servidor calcula solo sobre etapas abiertas — si acá no se
        // filtra igual, con "Ver ganados/perdidos/pausados" activo el chip
        // muestra más filas de las que decía la tarjeta.
        if (quickFilter === "alta" && (!isOpenStage(r.stage) || r.priority !== "ALTA")) return false;
        if (quickFilter === "sin_accion" && (!isOpenStage(r.stage) || (r.nextAction && r.nextActionAt)))
          return false;
        if (quickFilter === "hoy" && d !== todayStr) return false;
        if (quickFilter === "vencidos" && !(isOpenStage(r.stage) && d && d < todayStr)) return false;
        if (quickFilter === "semana" && !(d && d >= todayStr && d <= weekAheadStr)) return false;
      }
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        r.client.toLowerCase().includes(q) ||
        r.phone.includes(q) ||
        r.city.toLowerCase().includes(q) ||
        r.service.toLowerCase().includes(q) ||
        r.need.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (!sortField) return 0;
      const va = sortValue(a, sortField);
      const vb = sortValue(b, sortField);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

  const quickFilterChips: { key: NonNullable<QuickFilter>; label: string }[] = [
    { key: "hoy", label: "Hoy" },
    { key: "vencidos", label: "Vencidos" },
    { key: "semana", label: "Esta semana" },
    { key: "alta", label: "Alta prioridad" },
    { key: "sin_accion", label: "Sin próxima acción" },
  ];

  return (
    <div className="space-y-4">
      {/* Los cuatro indicadores de la cabecera — clicables, funcionan como filtro rápido */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Oportunidades activas"
          value={summary.activeCount.toString()}
          active={quickFilter === null && !hasActiveFilter}
          onClick={() => setQuickFilter(null)}
        />
        <Stat
          label="Acciones vencidas"
          value={summary.overdueCount.toString()}
          active={quickFilter === "vencidos"}
          onClick={() => setQuickFilter((f) => (f === "vencidos" ? null : "vencidos"))}
        />
        <Stat
          label="Prioridad alta"
          value={summary.highPriorityCount.toString()}
          active={quickFilter === "alta"}
          onClick={() => setQuickFilter((f) => (f === "alta" ? null : "alta"))}
        />
        <Stat
          label="Sin próxima acción"
          value={summary.noNextActionCount.toString()}
          active={quickFilter === "sin_accion"}
          onClick={() => setQuickFilter((f) => (f === "sin_accion" ? null : "sin_accion"))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-faint">Filtros rápidos:</span>
        {quickFilterChips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setQuickFilter((f) => (f === c.key ? null : c.key))}
            className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              quickFilter === c.key
                ? "border-accent bg-accent text-accent-ink"
                : "border-border text-ink-muted hover:border-accent-dim hover:text-accent"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cliente, teléfono, ciudad…"
          className="w-full py-1.5 text-sm sm:w-64"
        />
        <Select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value as Stage | "")}
          className="w-full py-1.5 text-sm sm:w-48"
        >
          <option value="">Todos los estados</option>
          {ALL_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as Priority | "")}
          className="w-full py-1.5 text-sm sm:w-36"
        >
          <option value="">Toda prioridad</option>
          <option value="ALTA">ALTA</option>
          <option value="MEDIA">MEDIA</option>
          <option value="BAJA">BAJA</option>
        </Select>
        <Select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="w-full py-1.5 text-sm sm:w-40"
        >
          <option value="">Todo vendedor</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          className="w-full py-1.5 text-sm sm:w-36"
        >
          <option value="">Todo servicio</option>
          {SERVICES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="Próximo contacto desde"
            className="w-full py-1.5 text-sm sm:w-36"
          />
          <span className="text-xs text-ink-faint">–</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="Próximo contacto hasta"
            className="w-full py-1.5 text-sm sm:w-36"
          />
        </div>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => {
              setStageFilter("");
              setPriorityFilter("");
              setDateFrom("");
              setDateTo("");
              setAssigneeFilter("");
              setServiceFilter("");
              setQuickFilter(null);
            }}
            className="cursor-pointer whitespace-nowrap text-xs text-ink-faint hover:text-accent"
          >
            Quitar filtros
          </button>
        )}
        {sortField && (
          <button
            type="button"
            onClick={clearSort}
            className="cursor-pointer whitespace-nowrap text-xs text-ink-faint hover:text-accent"
          >
            Quitar orden por columna
          </button>
        )}
        <Link
          href={viewingArchived ? "/dashboard/seguimiento" : "/dashboard/seguimiento?archived=1"}
          className="flex items-center gap-1 whitespace-nowrap text-xs text-ink-muted hover:text-accent"
        >
          {viewingArchived ? (
            <>
              <ArchiveRestore size={13} /> Ver activos
            </>
          ) : (
            <>
              <Archive size={13} /> Ver archivados
            </>
          )}
        </Link>
        {!viewingArchived && (
          <Link
            href={viewingAllStages ? "/dashboard/seguimiento" : "/dashboard/seguimiento?estado=todos"}
            title="Ganado, Perdido y En pausa/Nutrir quedan ocultos por defecto para no competir con lo activo"
            className="flex items-center gap-1 whitespace-nowrap text-xs text-ink-muted hover:text-accent"
          >
            <Eye size={13} /> {viewingAllStages ? "Ocultar cerrados/pausados" : "Ver ganados/perdidos/pausados"}
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => setBoardView("table")}
              title="Vista de tabla"
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                boardView === "table" ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              <Table2 size={13} />
            </button>
            <button
              type="button"
              onClick={() => setBoardView("kanban")}
              title="Vista de tablero"
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                boardView === "kanban" ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              <LayoutGrid size={13} />
            </button>
          </div>
          {!viewingArchived && (
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus size={16} /> Nueva oportunidad
            </Button>
          )}
        </div>
      </div>

      {boardView === "table" && !viewingArchived && !sortField && (
        <p className="text-xs text-ink-faint">
          {canDrag
            ? "Arrastra una fila desde el ícono ⠿ para reordenarla a mano."
            : "Quita la búsqueda y los filtros para poder reordenar filas a mano."}
        </p>
      )}

      {creating && (
        <Card>
          <CreateForm contacts={contacts} onDone={closeCreate} />
        </Card>
      )}

      {rows.length === 0 && !creating && (
        <Card className="text-sm text-ink-muted">
          {viewingArchived
            ? "No hay clientes archivados."
            : "Todavía no hay clientes en seguimiento. Agrega uno desde un contacto que ya escribió por WhatsApp."}
        </Card>
      )}

      {rows.length > 0 && boardView === "kanban" && (
        <KanbanBoard rows={filtered} currentUserId={currentUserId} isAdmin={isAdmin} onOpen={setDetail} />
      )}

      {rows.length > 0 && boardView === "table" && (
        <>
        <div ref={tableScrollRef} onScroll={handleTableScroll} className="-mx-4 overflow-x-auto md:-mx-8">
          <div className="min-w-max px-4 md:px-8">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {canDrag && <Th />}
                  <SortableTh field="registeredAt" sortField={sortField} sortDir={sortDir} onSort={toggleSort}>
                    Fecha registro
                  </SortableTh>
                  <SortableTh field="client" sortField={sortField} sortDir={sortDir} onSort={toggleSort} frozen>
                    Cliente
                  </SortableTh>
                  <Th>Teléfono</Th>
                  <Th>Ciudad</Th>
                  <Th>Servicio</Th>
                  <Th>Necesidad / contexto</Th>
                  <SortableTh field="stage" sortField={sortField} sortDir={sortDir} onSort={toggleSort}>
                    Estado
                  </SortableTh>
                  <Th>Próxima acción</Th>
                  <Th>Última actualización</Th>
                  {/* De aquí en adelante lo llena el asesor IA */}
                  <SortableTh
                    field="leadScore"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    ai
                    title="Qué tan buen prospecto es según necesidad, encaje, autoridad, capacidad y urgencia."
                  >
                    Calidad del lead
                  </SortableTh>
                  <SortableTh field="priority" sortField={sortField} sortDir={sortDir} onSort={toggleSort} ai>
                    Prioridad
                  </SortableTh>
                  <SortableTh
                    field="nextContactAt"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    ai
                  >
                    Próximo contacto
                  </SortableTh>
                  <SortableTh
                    field="probability"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    ai
                    title="Qué tan cerca está actualmente de convertirse en una venta."
                  >
                    Prob. de cierre
                  </SortableTh>
                  <Th ai>Recomendación para cerrar</Th>
                  <Th ai>Mensaje sugerido</Th>
                  <Th ai>Analizar</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <TableRow
                    key={row.id}
                    row={row}
                    aiEnabled={ai.enabled}
                    editable={canEdit(row, currentUserId, isAdmin)}
                    onOpen={() => setDetail(row)}
                    draggable={canDrag}
                    onDragStart={() => {
                      dragIdRef.current = row.id;
                    }}
                    onDropRow={() => handleDrop(row.id)}
                  />
                ))}
              </tbody>
            </table>

            {filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-ink-faint">
                Ningún cliente coincide con el filtro.
              </p>
            )}

            <p className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
              <Sparkles size={11} />
              Las últimas cinco columnas las propone el asesor IA; el vendedor decide.
              {ai.enabled ? (
                <span className="font-mono">
                  · Gasto de hoy: {ai.spent.toFixed(3)} / {ai.budget.toFixed(2)} US$
                </span>
              ) : (
                <span className="text-warning">· Asesor IA sin configurar (falta OPENAI_API_KEY)</span>
              )}
            </p>
          </div>
        </div>

        {/* Barra de scroll horizontal "espejo": pegada abajo de la
            pantalla, no del final de la tabla — visible sin importar
            cuántas filas haya que bajar. Solo si de verdad hay que
            scrollear (si entra todo, no tiene sentido mostrarla). */}
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
      )}

      {detail && (
        <DetailPanel
          row={detail}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          members={members}
          editable={canEdit(detail, currentUserId, isAdmin)}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

function Th({ children, ai }: { children?: React.ReactNode; ai?: boolean }) {
  return (
    <th
      className={`sticky top-0 z-20 whitespace-nowrap border-b border-border bg-surface px-3 py-2.5 text-left font-mono text-[11px] font-semibold uppercase tracking-wide ${
        ai ? "text-accent" : "text-ink-muted"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={`border-b border-border/50 px-3 py-4 align-top ${className}`}>{children}</td>
  );
}

function SortableTh({
  field,
  sortField,
  sortDir,
  onSort,
  ai,
  frozen,
  title,
  children,
}: {
  field: SortField;
  sortField: SortField | null;
  sortDir: "asc" | "desc";
  onSort: (field: SortField) => void;
  ai?: boolean;
  /** Congela esta columna al hacer scroll horizontal — debe coincidir con
   * la celda del cuerpo que usa `sticky left-0` para la misma columna. */
  frozen?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  const active = sortField === field;
  return (
    <th
      title={title}
      className={`sticky top-0 whitespace-nowrap border-b border-border bg-surface px-1 py-1 text-left font-mono text-[11px] font-semibold uppercase tracking-wide ${
        frozen ? "left-0 z-30 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.3)]" : "z-20"
      } ${ai ? "text-accent" : "text-ink-muted"}`}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 hover:bg-surface-2 ${
          active ? "text-ink" : ""
        }`}
      >
        {children}
        {active &&
          (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

/** Texto + fecha de la próxima acción, con el aviso si falta alguno de los
 * dos — reusado en la tabla, el Kanban y la ficha. */
function NextActionCell({
  row,
  locked,
  onSave,
}: {
  row: Row;
  locked: boolean;
  onSave: (field: string, value: string) => void;
}) {
  const badge = dueBadge(row.nextActionAt);
  const missing = !row.nextAction || !row.nextActionAt;
  return (
    <div className="space-y-1">
      <Input
        defaultValue={row.nextAction}
        disabled={locked}
        placeholder="Ej. Llamar para calificar"
        onBlur={(e) => onSave("nextAction", e.target.value)}
        className="w-full py-1 text-xs"
      />
      <Input
        type="date"
        defaultValue={dateInputValue(row.nextActionAt)}
        disabled={locked}
        onBlur={(e) => onSave("nextActionAt", e.target.value)}
        className="w-full py-1 text-xs"
      />
      {missing ? (
        <p className="flex items-center gap-1 text-[11px] text-warning">
          <AlertTriangle size={10} /> Sin próxima acción
        </p>
      ) : (
        badge && (
          <p className="text-[11px] font-medium" style={{ color: badge.color }}>
            {badge.text}
          </p>
        )
      )}
    </div>
  );
}

function TableRow({
  row,
  aiEnabled,
  editable,
  onOpen,
  draggable,
  onDragStart,
  onDropRow,
}: {
  row: Row;
  aiEnabled: boolean;
  editable: boolean;
  onOpen: () => void;
  draggable: boolean;
  onDragStart: () => void;
  onDropRow: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const locked = !editable || isPending;

  function save(field: string, value: string) {
    startTransition(async () => {
      setError(null);
      const result = await updateOpportunityFieldAction(row.id, field, value);
      if (result.error) setError(result.error);
    });
  }

  return (
    <>
    <tr
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      onDrop={draggable ? onDropRow : undefined}
      className={`transition-colors hover:bg-surface-2/40 ${isPending ? "opacity-60" : ""} ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      {draggable && (
        <Td className="w-6 px-1 text-ink-faint">
          <GripVertical size={14} />
        </Td>
      )}
      <Td className="whitespace-nowrap font-mono text-[13px] text-ink-muted">
        {dateShort(row.registeredAt)}
      </Td>

      <Td className="sticky left-0 z-10 max-w-[9rem] bg-surface shadow-[2px_0_4px_-2px_rgba(0,0,0,0.3)]">
        <button
          type="button"
          onClick={onOpen}
          className="truncate text-left font-medium text-ink hover:text-accent"
        >
          {row.client || "—"}
        </button>
        {row.assignedTo ? (
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: vendorColor(row.assignedTo.id, row.assignedTo.color) }}
            />
            {row.assignedTo.name}
          </span>
        ) : (
          <span className="mt-1 block text-[11px] italic text-ink-faint">Sin asignar</span>
        )}
      </Td>

      <Td className="whitespace-nowrap font-mono text-[13px] text-ink-muted">{row.phone}</Td>
      <Td className="whitespace-nowrap text-sm text-ink-muted">{row.city || "—"}</Td>

      <Td>
        <Select
          value={row.service}
          disabled={locked}
          onChange={(e) => save("serviceInterest", e.target.value)}
          className="w-28 py-1.5 text-sm"
        >
          <option value="">—</option>
          {SERVICES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          {row.service && !SERVICES.includes(row.service as (typeof SERVICES)[number]) && (
            <option value={row.service}>{row.service}</option>
          )}
        </Select>
      </Td>

      <Td className="max-w-[14rem]">
        <p className="line-clamp-3 w-56 text-sm leading-relaxed text-ink">{row.need || "—"}</p>
      </Td>

      <Td>
        <Select
          value={row.stage}
          disabled={locked}
          onChange={(e) => save("stage", e.target.value)}
          className="w-32 py-1.5 text-sm font-semibold"
          style={{ color: STAGE_COLOR[row.stage] }}
        >
          {ALL_STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </Select>
      </Td>

      <Td className="max-w-[11rem]">
        <NextActionCell row={row} locked={locked} onSave={save} />
      </Td>

      <Td className="max-w-[14rem]">
        <p className="line-clamp-3 w-56 text-sm leading-relaxed text-ink-muted">{row.lastUpdate || "—"}</p>
      </Td>

      {/* ── Columnas del asesor IA ── */}
      <Td>
        {row.leadScore !== null ? (
          <div
            title={leadScoreLabel(row.leadScore)}
            className="flex items-center gap-1.5 whitespace-nowrap font-mono text-xs font-semibold"
            style={{ color: leadScoreColor(row.leadScore) }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: leadScoreColor(row.leadScore) }}
            />
            {row.leadScore}/100
          </div>
        ) : (
          <span className="text-xs text-ink-faint">—</span>
        )}
      </Td>

      <Td>
        <Select
          value={row.priority ?? ""}
          disabled={locked}
          onChange={(e) => save("priority", e.target.value)}
          className="w-24 py-1.5 text-sm font-semibold"
          style={{ color: row.priority ? PRIORITY_COLOR[row.priority] : undefined }}
        >
          <option value="">—</option>
          <option value="ALTA">ALTA</option>
          <option value="MEDIA">MEDIA</option>
          <option value="BAJA">BAJA</option>
        </Select>
      </Td>

      <Td>
        <Input
          type="date"
          defaultValue={dateInputValue(row.nextContactAt)}
          disabled={locked}
          onBlur={(e) => save("nextContactAt", e.target.value)}
          className="w-32 py-1.5 text-sm"
        />
      </Td>

      <Td>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min="0"
            max="100"
            defaultValue={row.probability ?? ""}
            disabled={locked}
            onBlur={(e) => e.target.value && save("probability", e.target.value)}
            className="w-16 py-1.5 text-sm"
          />
          <span className="text-xs text-ink-faint">%</span>
        </div>
      </Td>

      <Td className="max-w-[14rem]">
        <p className="line-clamp-3 w-56 text-sm leading-relaxed text-ink">{row.aiRecommendation || "—"}</p>
      </Td>

      <Td className="max-w-[14rem]">
        {row.aiSuggestedMessage ? (
          <CopyableMessage text={row.aiSuggestedMessage} />
        ) : (
          <span className="text-xs text-ink-faint">—</span>
        )}
      </Td>

      <Td>
        <AnalyzeButton
          opportunityId={row.id}
          disabled={!aiEnabled || !editable}
          title={!editable ? "Solo quien tiene asignado este cliente puede analizarlo" : undefined}
        />
      </Td>

      <Td>
        <button
          type="button"
          onClick={onOpen}
          className="cursor-pointer whitespace-nowrap text-xs text-ink-muted hover:text-accent"
        >
          Ver
        </button>
      </Td>
    </tr>
    {error && (
      <tr>
        <td colSpan={16} className="border-b border-border px-3 pb-2 text-xs text-danger">
          {error}
        </td>
      </tr>
    )}
    </>
  );
}

function AnalyzeButton({
  opportunityId,
  disabled,
  title,
}: {
  opportunityId: string;
  disabled: boolean;
  title?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="whitespace-nowrap">
      <button
        type="button"
        disabled={disabled || isPending}
        title={title ?? (disabled ? "Falta configurar OPENAI_API_KEY" : "Pedir análisis al asesor IA")}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await analyzeOpportunityAction(opportunityId);
            if (result.error) setError(result.error);
          })
        }
        className="flex cursor-pointer items-center gap-1 rounded-md border border-accent-dim/50 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPending ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Analizando…
          </>
        ) : (
          <Sparkles size={13} />
        )}
      </button>
      {error && <p className="mt-1 max-w-[11rem] text-[11px] text-danger">{error}</p>}
    </div>
  );
}

function CopyableMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-start gap-1.5">
      <p className="line-clamp-3 w-48 text-sm leading-relaxed text-ink">{text}</p>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        title="Copiar mensaje"
        className="shrink-0 cursor-pointer text-ink-faint hover:text-accent"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function Stat({
  label,
  value,
  onClick,
  active,
}: {
  label: string;
  value: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const content = (
    <>
      <CardDescription className="mb-1 font-mono text-[11px] uppercase tracking-wide">
        {label}
      </CardDescription>
      <CardTitle className="font-mono text-xl">{value}</CardTitle>
    </>
  );

  if (!onClick) {
    return <Card className="py-3">{content}</Card>;
  }

  return (
    <button type="button" onClick={onClick} className="w-full cursor-pointer text-left">
      <Card className={`py-3 transition-colors ${active ? "border-accent bg-accent/5" : "hover:border-accent-dim"}`}>
        {content}
      </Card>
    </button>
  );
}

function CreateForm({
  contacts,
  onDone,
}: {
  contacts: { id: string; label: string }[];
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(createOpportunityAction, { error: null });
  const saved = Boolean(state.message) && !isPending;
  const [isNewContact, setIsNewContact] = useState(contacts.length === 0);

  useEffect(() => {
    if (saved) onDone();
  }, [saved, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-sm font-semibold text-ink">Nueva oportunidad</p>
        <button type="button" onClick={onDone} className="cursor-pointer text-ink-faint hover:text-ink">
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={isNewContact ? "newContactPhone" : "contactId"}>Contacto</Label>
            {contacts.length > 0 && (
              <button
                type="button"
                onClick={() => setIsNewContact((v) => !v)}
                className="cursor-pointer text-xs text-accent hover:underline"
              >
                {isNewContact ? "Elegir uno existente" : "Es un lead nuevo (no está en contactos)"}
              </button>
            )}
          </div>
          {isNewContact ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input id="newContactPhone" name="newContactPhone" placeholder="Teléfono (ej. 59178795415)" required />
              <Input id="newContactName" name="newContactName" placeholder="Nombre (opcional)" />
            </div>
          ) : (
            <Select id="contactId" name="contactId" required>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="serviceInterest">Servicio</Label>
          <Select id="serviceInterest" name="serviceInterest">
            {SERVICES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="title">Necesidad / contexto</Label>
        <Input id="title" name="title" placeholder="Ej. Agente IA de ventas para su tienda" required />
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Agregando…" : "Agregar"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function DetailPanel({
  row,
  currentUserId,
  isAdmin,
  members,
  editable,
  onClose,
}: {
  row: Row;
  currentUserId: string;
  isAdmin: boolean;
  members: Member[];
  editable: boolean;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = !editable || isPending;

  function save(field: string, value: string) {
    startTransition(async () => {
      setError(null);
      const result = await updateOpportunityFieldAction(row.id, field, value);
      if (result.error) setError(result.error);
    });
  }

  // Se monta en el <body>: si queda dentro del árbol de la página, cualquier
  // ancestro con transform (por ejemplo la animación de entrada) lo atrapa y
  // el panel se recorta al alto del contenido en vez de cubrir la pantalla.
  return createPortal(
    <div data-portal className="fixed inset-0 z-[100] flex justify-end">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <aside className="relative flex w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-surface p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-ink">
              {row.client || row.phone}
            </h2>
            <p className="font-mono text-[13px] text-ink-faint">
              {row.phone}
              {row.city && ` · ${row.city}`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="cursor-pointer text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {!editable && (
            <p className="rounded-md border border-border bg-surface-2/60 px-3 py-2 text-xs text-ink-faint">
              Este cliente está asignado a otro vendedor — puedes verlo, pero no editarlo.
            </p>
          )}

          {error && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <Field label="Necesidad / contexto">
            {editable ? (
              <EditableText
                value={row.need}
                disabled={locked}
                onSave={(v) => save("needSummary", v)}
                placeholder="Qué necesita y en qué contexto"
              />
            ) : (
              <p className="text-sm leading-relaxed text-ink">{row.need || "—"}</p>
            )}
          </Field>

          <Field label="Última actualización">
            {editable ? (
              <EditableText
                value={row.lastUpdate}
                disabled={locked}
                onSave={(v) => save("lastUpdate", v)}
                placeholder="Qué pasó en el último contacto"
              />
            ) : (
              <p className="text-sm leading-relaxed text-ink-muted">{row.lastUpdate || "—"}</p>
            )}
          </Field>

          <Field label="Próxima acción">
            {editable ? (
              <div className="flex gap-2">
                <Input
                  defaultValue={row.nextAction}
                  disabled={locked}
                  placeholder="Ej. Llamar para calificar"
                  onBlur={(e) => save("nextAction", e.target.value)}
                  className="flex-1 py-1.5 text-sm"
                />
                <Input
                  type="date"
                  defaultValue={dateInputValue(row.nextActionAt)}
                  disabled={locked}
                  onBlur={(e) => save("nextActionAt", e.target.value)}
                  className="w-36 py-1.5 text-sm"
                />
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-ink-muted">
                {row.nextAction || "—"}
                {row.nextActionAt && ` · ${dateShort(row.nextActionAt)}`}
              </p>
            )}
            {(!row.nextAction || !row.nextActionAt) && (
              <p className="flex items-center gap-1 text-xs text-warning">
                <AlertTriangle size={11} /> Sin próxima acción
              </p>
            )}
          </Field>

          {row.stage === "PERDIDO" && editable && (
            <Field label="Motivo de la pérdida">
              <EditableText
                value={row.lostReason}
                disabled={locked}
                onSave={(v) => save("lostReason", v)}
                placeholder="Precio, tiempos, se fue con otro proveedor…"
              />
            </Field>
          )}

          <MeetingsSection
            opportunityId={row.id}
            meetings={row.meetings}
            editable={editable}
            disabled={locked}
          />

          <div className="rounded-lg border border-accent-dim/40 bg-accent/5 p-3">
            <p className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent">
              <Sparkles size={11} /> Asesor IA
            </p>

            {row.leadScore !== null && (
              <div className="mb-3 rounded-md border border-border bg-surface p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p
                      className="font-mono text-2xl font-bold leading-none"
                      style={{ color: leadScoreColor(row.leadScore) }}
                    >
                      {row.leadScore}
                      <span className="text-sm font-normal text-ink-faint">/100</span>
                    </p>
                    <p className="text-xs text-ink-muted">Calidad del lead — {leadScoreLabel(row.leadScore)}</p>
                  </div>
                  {row.leadScoreCoverage !== null && (
                    <p className="text-xs text-ink-faint">
                      Cobertura de información: <span className="text-ink">{row.leadScoreCoverage}%</span>
                    </p>
                  )}
                </div>

                {row.leadScoreBreakdown && (
                  <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1">
                    {Object.entries(row.leadScoreBreakdown).map(([key, value]) => {
                      const meta = LEAD_SCORE_BREAKDOWN_LABEL[key];
                      if (!meta) return null;
                      const [label, max] = meta;
                      return (
                        <p key={key} className="flex justify-between text-xs text-ink-muted">
                          <span>{label}</span>
                          <span className="font-mono text-ink">
                            {value}/{max}
                          </span>
                        </p>
                      );
                    })}
                  </div>
                )}

                {row.aiPainPoint && (
                  <p className="mb-1.5 text-sm leading-relaxed text-ink">
                    <span className="font-medium">Dolor principal:</span> {row.aiPainPoint}
                  </p>
                )}
                {row.aiMissingInfo && (
                  <p className="mb-1.5 whitespace-pre-wrap text-xs leading-relaxed text-ink-muted">
                    <span className="font-medium text-ink">Falta saber:</span>
                    {"\n"}
                    {row.aiMissingInfo}
                  </p>
                )}
                {row.aiNextQuestion && (
                  <p className="mb-1.5 text-xs leading-relaxed text-ink-muted">
                    <span className="font-medium text-ink">Siguiente pregunta:</span> {row.aiNextQuestion}
                  </p>
                )}
                {row.aiAlerts && row.aiAlerts !== "Sin alertas relevantes." && (
                  <p className="text-xs leading-relaxed text-warning">⚠ {row.aiAlerts}</p>
                )}
              </div>
            )}

            <Field label="Recomendación para cerrar">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {row.aiRecommendation || "Todavía sin análisis."}
              </p>
            </Field>

            <div className="mt-3">
              <Field label="Mensaje sugerido">
                {row.aiSuggestedMessage ? (
                  <CopyableMessage text={row.aiSuggestedMessage} />
                ) : (
                  <p className="text-sm text-ink-faint">Todavía sin análisis.</p>
                )}
              </Field>
            </div>

            {row.aiMemory && (
              <div className="mt-3">
                <Field label="Lo que sabemos de este cliente">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                    {row.aiMemory}
                  </p>
                </Field>
              </div>
            )}
          </div>

          <AssignmentControl
            row={row}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            members={members}
            disabled={isPending}
            onAssign={(value) => save("assignedToId", value)}
          />

          {editable && (
            <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    if (row.archived) {
                      await unarchiveOpportunityAction(row.id);
                    } else {
                      await archiveOpportunityAction(row.id);
                      onClose();
                    }
                  })
                }
                className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-faint hover:text-accent"
              >
                {row.archived ? (
                  <>
                    <ArchiveRestore size={13} /> Desarchivar
                  </>
                ) : (
                  <>
                    <Archive size={13} /> Archivar
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                    setTimeout(() => setConfirmDelete(false), 3000);
                    return;
                  }
                  startTransition(async () => {
                    await deleteOpportunityAction(row.id);
                    onClose();
                  });
                }}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-faint hover:text-danger"
              >
                <Trash2 size={13} />
                {confirmDelete ? "¿Seguro? Toca de nuevo" : "Quitar del seguimiento"}
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function AssignmentControl({
  row,
  currentUserId,
  isAdmin,
  members,
  disabled,
  onAssign,
}: {
  row: Row;
  currentUserId: string;
  isAdmin: boolean;
  members: Member[];
  disabled: boolean;
  onAssign: (value: string) => void;
}) {
  if (isAdmin) {
    return (
      <Field label="Asignado a">
        <Select
          value={row.assignedTo?.id ?? ""}
          disabled={disabled}
          onChange={(e) => onAssign(e.target.value)}
          className="w-full py-1.5 text-sm"
        >
          <option value="">Sin asignar</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  if (!row.assignedTo) {
    return (
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => onAssign(currentUserId)}>
        Tomar este cliente
      </Button>
    );
  }

  if (row.assignedTo.id === currentUserId) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: vendorColor(row.assignedTo.id, row.assignedTo.color) }} />
          Tú
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAssign("")}
          className="cursor-pointer text-xs text-ink-faint hover:text-ink"
        >
          Soltarlo (vuelve a quedar libre)
        </button>
      </div>
    );
  }

  return (
    <p className="flex items-center gap-1.5 text-xs text-ink-muted">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: vendorColor(row.assignedTo.id, row.assignedTo.color) }} />
      {row.assignedTo.name}
    </p>
  );
}

function MeetingsSection({
  opportunityId,
  meetings,
  editable,
  disabled,
}: {
  opportunityId: string;
  meetings: Row["meetings"];
  editable: boolean;
  disabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [state, formAction] = useActionState(createMeetingAction, { error: null });
  const [handledMessage, setHandledMessage] = useState<string | undefined>(undefined);
  if (state.message && state.message !== handledMessage) {
    setHandledMessage(state.message);
    setAdding(false);
  }
  // Borrar una reunión se lleva sus adjuntos con ella — igual de
  // irreversible que borrar la oportunidad, mismo patrón de confirmación.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  function handleDeleteMeeting(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirmDeleteId(null);
    startTransition(async () => {
      await deleteMeetingAction(id);
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          <Video size={11} /> Reuniones
        </p>
        {editable && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAdding((v) => !v)}
            className="cursor-pointer text-xs text-accent hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {adding ? "Cancelar" : "+ Registrar reunión"}
          </button>
        )}
      </div>

      {adding && (
        <form action={formAction} className="mb-3 space-y-2 rounded-md border border-border p-2.5">
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <div className="flex gap-2">
            <Input type="date" name="scheduledAt" required className="py-1.5 text-xs" />
            <Input
              type="number"
              name="durationMinutes"
              placeholder="min"
              min={1}
              className="w-20 py-1.5 text-xs"
            />
          </div>
          <textarea
            name="notes"
            rows={5}
            placeholder="Pega acá la transcripción o el resumen de la reunión…"
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-ink outline-none focus:border-accent-dim"
          />
          {state.error && <p className="text-xs text-danger">{state.error}</p>}
          <Button type="submit" size="sm" className="text-xs">
            Guardar reunión
          </Button>
        </form>
      )}

      {meetings.length === 0 ? (
        <p className="text-xs text-ink-faint">Todavía no hay reuniones registradas.</p>
      ) : (
        <ul className="space-y-2">
          {meetings.map((m) => (
            <li key={m.id} className="rounded-md border border-border p-2.5">
              <div className="mb-1 flex items-center justify-between">
                <p className="font-mono text-xs text-ink-muted">
                  {new Date(m.scheduledAt).toLocaleDateString("es")} · {m.status}
                </p>
                {editable && (
                  <button
                    type="button"
                    disabled={disabled || isPending}
                    onClick={() => handleDeleteMeeting(m.id)}
                    className={`cursor-pointer disabled:cursor-not-allowed ${
                      confirmDeleteId === m.id ? "text-danger" : "text-ink-faint hover:text-danger"
                    }`}
                    title={confirmDeleteId === m.id ? "¿Seguro? Toca de nuevo" : "Borrar reunión"}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              {editable ? (
                <EditableText
                  value={m.notes}
                  disabled={disabled}
                  placeholder="Transcripción o resumen de la reunión"
                  onSave={(v) => startTransition(async () => { await updateMeetingNotesAction(m.id, v); })}
                />
              ) : (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-muted">
                  {m.notes || "(sin transcripción cargada)"}
                </p>
              )}

              <MeetingAttachments
                meetingId={m.id}
                attachments={m.attachments}
                editable={editable}
                disabled={disabled}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MeetingAttachments({
  meetingId,
  attachments,
  editable,
  disabled,
}: {
  meetingId: string;
  attachments: MeetingAttachmentInfo[];
  editable: boolean;
  disabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function handleDeleteAttachment(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirmDeleteId(null);
    startTransition(async () => {
      await deleteMeetingAttachmentAction(id);
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadError(null);
    startTransition(async () => {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const result = await addMeetingAttachmentAction(meetingId, formData);
        if (result.error) {
          setUploadError(result.error);
          break;
        }
      }
    });
    e.target.value = "";
  }

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      {attachments.length > 0 && (
        <ul className="mb-1.5 space-y-1">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5 text-[11px]">
              <FileText size={11} className="shrink-0 text-ink-faint" />
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-accent hover:underline"
                title={a.fileName}
              >
                {a.fileName}
              </a>
              <span className="shrink-0 text-ink-faint">({formatFileSize(a.fileSize)})</span>
              {editable && (
                <button
                  type="button"
                  disabled={disabled || isPending}
                  onClick={() => handleDeleteAttachment(a.id)}
                  className={`ml-auto shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                    confirmDeleteId === a.id ? "text-danger" : "text-ink-faint hover:text-danger"
                  }`}
                  title={confirmDeleteId === a.id ? "¿Seguro? Toca de nuevo" : "Borrar archivo"}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <label
          className={`flex w-fit items-center gap-1 text-[11px] ${
            disabled || isPending ? "cursor-not-allowed text-ink-faint" : "cursor-pointer text-accent hover:opacity-80"
          }`}
        >
          <Paperclip size={11} />
          {isPending ? "Subiendo…" : "Adjuntar archivo"}
          <input
            type="file"
            multiple
            disabled={disabled || isPending}
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
      )}
      {uploadError && <p className="mt-1 text-[11px] text-danger">{uploadError}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function EditableText({
  value,
  onSave,
  disabled,
  placeholder,
}: {
  value: string;
  onSave: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;

  return (
    <div className="space-y-1.5">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-accent-dim"
      />
      {dirty && (
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => onSave(draft)}
          className="py-1.5 text-xs"
        >
          Guardar
        </Button>
      )}
    </div>
  );
}
