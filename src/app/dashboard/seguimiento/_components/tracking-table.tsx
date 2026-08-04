"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Plus, X, Copy, Check, Trash2, Sparkles, Loader2 } from "lucide-react";
import {
  createOpportunityAction,
  updateOpportunityFieldAction,
  deleteOpportunityAction,
  analyzeOpportunityAction,
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
  type Stage,
  type Priority,
} from "@/lib/pipeline";
import { vendorColor } from "@/lib/vendor-color";

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
  probability: number | null;
  aiRecommendation: string;
  aiSuggestedMessage: string;
  assignedTo: { id: string; name: string } | null;
}

interface Props {
  rows: Row[];
  contacts: { id: string; label: string }[];
  currentUserId: string;
  summary: {
    inFollowUp: number;
    quotesSent: number;
    highPriority: number;
    nextContact: string | null;
  };
  ai: { spent: number; budget: number; enabled: boolean };
}

function dateFmt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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

export function TrackingTable({ rows, contacts, currentUserId, summary, ai }: Props) {
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<Stage | "">("");

  const closeCreate = useCallback(() => setCreating(false), []);
  const closeDetail = useCallback(() => setDetail(null), []);

  const filtered = rows.filter((r) => {
    if (stageFilter && r.stage !== stageFilter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      r.client.toLowerCase().includes(q) ||
      r.phone.includes(q) ||
      r.city.toLowerCase().includes(q) ||
      r.service.toLowerCase().includes(q) ||
      r.need.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {/* Los mismos cuatro indicadores de la cabecera de la planilla */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Clientes en seguimiento" value={summary.inFollowUp.toString()} />
        <Stat label="Cotizaciones enviadas" value={summary.quotesSent.toString()} />
        <Stat label="Prioridad alta" value={summary.highPriority.toString()} />
        <Stat label="Próximo contacto" value={dateFmt(summary.nextContact) || "—"} />
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
        <Button type="button" onClick={() => setCreating(true)} className="ml-auto">
          <Plus size={16} /> Agregar cliente
        </Button>
      </div>

      {creating && (
        <Card>
          <CreateForm contacts={contacts} onDone={closeCreate} />
        </Card>
      )}

      {rows.length === 0 && !creating && (
        <Card className="text-sm text-ink-muted">
          Todavía no hay clientes en seguimiento. Agrega uno desde un contacto que ya escribió
          por WhatsApp.
        </Card>
      )}

      {rows.length > 0 && (
        <div className="-mx-4 overflow-x-auto md:-mx-8">
          <div className="min-w-max px-4 md:px-8">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {[
                    "Fecha registro",
                    "Cliente",
                    "Teléfono",
                    "Ciudad",
                    "Servicio",
                    "Necesidad / contexto",
                    "Estado",
                    "Última actualización",
                  ].map((h) => (
                    <Th key={h}>{h}</Th>
                  ))}
                  {/* De aquí en adelante lo llena el asesor IA */}
                  {["Prioridad", "Próximo contacto", "Prob. de cierre", "Recomendación para cerrar", "Mensaje sugerido"].map(
                    (h) => (
                      <Th key={h} ai>
                        {h}
                      </Th>
                    ),
                  )}
                  <Th ai>Analizar</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <TableRow key={row.id} row={row} aiEnabled={ai.enabled} onOpen={() => setDetail(row)} />
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
      )}

      {detail && (
        <DetailPanel row={detail} currentUserId={currentUserId} onClose={closeDetail} />
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
    <td className={`border-b border-border/50 px-3 py-3 align-top ${className}`}>{children}</td>
  );
}

function TableRow({
  row,
  aiEnabled,
  onOpen,
}: {
  row: Row;
  aiEnabled: boolean;
  onOpen: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function save(field: string, value: string) {
    startTransition(async () => {
      await updateOpportunityFieldAction(row.id, field, value);
    });
  }

  return (
    <tr className={`transition-colors hover:bg-surface-2/40 ${isPending ? "opacity-60" : ""}`}>
      <Td className="whitespace-nowrap font-mono text-[13px] text-ink-muted">
        {dateShort(row.registeredAt)}
      </Td>

      <Td className="sticky left-0 z-10 max-w-[9rem] bg-surface">
        <button
          type="button"
          onClick={onOpen}
          className="truncate text-left font-medium text-ink hover:text-accent"
        >
          {row.client || "—"}
        </button>
        {row.assignedTo && (
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: vendorColor(row.assignedTo.id) }}
            />
            {row.assignedTo.name}
          </span>
        )}
      </Td>

      <Td className="whitespace-nowrap font-mono text-[13px] text-ink-muted">{row.phone}</Td>
      <Td className="whitespace-nowrap text-sm text-ink-muted">{row.city || "—"}</Td>

      <Td>
        <Select
          value={row.service}
          disabled={isPending}
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
        <p className="line-clamp-2 w-56 text-sm leading-snug text-ink">{row.need || "—"}</p>
      </Td>

      <Td>
        <Select
          value={row.stage}
          disabled={isPending}
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

      <Td className="max-w-[14rem]">
        <p className="line-clamp-2 w-56 text-sm leading-snug text-ink-muted">{row.lastUpdate || "—"}</p>
      </Td>

      {/* ── Columnas del asesor IA ── */}
      <Td>
        <Select
          value={row.priority ?? ""}
          disabled={isPending}
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
          disabled={isPending}
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
            disabled={isPending}
            onBlur={(e) => e.target.value && save("probability", e.target.value)}
            className="w-16 py-1.5 text-sm"
          />
          <span className="text-xs text-ink-faint">%</span>
        </div>
      </Td>

      <Td className="max-w-[14rem]">
        <p className="line-clamp-2 w-56 text-sm leading-snug text-ink">{row.aiRecommendation || "—"}</p>
      </Td>

      <Td className="max-w-[14rem]">
        {row.aiSuggestedMessage ? (
          <CopyableMessage text={row.aiSuggestedMessage} />
        ) : (
          <span className="text-xs text-ink-faint">—</span>
        )}
      </Td>

      <Td>
        <AnalyzeButton opportunityId={row.id} disabled={!aiEnabled} />
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
  );
}

function AnalyzeButton({
  opportunityId,
  disabled,
}: {
  opportunityId: string;
  disabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="whitespace-nowrap">
      <button
        type="button"
        disabled={disabled || isPending}
        title={disabled ? "Falta configurar OPENAI_API_KEY" : "Pedir análisis al asesor IA"}
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
      <p className="line-clamp-2 w-48 text-sm leading-snug text-ink">{text}</p>
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

function CreateForm({
  contacts,
  onDone,
}: {
  contacts: { id: string; label: string }[];
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState(createOpportunityAction, { error: null });
  const saved = Boolean(state.message) && !isPending;

  useEffect(() => {
    if (saved) onDone();
  }, [saved, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-sm font-semibold text-ink">Agregar cliente</p>
        <button type="button" onClick={onDone} className="cursor-pointer text-ink-faint hover:text-ink">
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contactId">Contacto</Label>
          <Select id="contactId" name="contactId" required>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
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
  onClose,
}: {
  row: Row;
  currentUserId: string;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  function save(field: string, value: string) {
    startTransition(async () => {
      await updateOpportunityFieldAction(row.id, field, value);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
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
          <Field label="Necesidad / contexto">
            <EditableText
              value={row.need}
              disabled={isPending}
              onSave={(v) => save("needSummary", v)}
              placeholder="Qué necesita y en qué contexto"
            />
          </Field>

          <Field label="Última actualización">
            <EditableText
              value={row.lastUpdate}
              disabled={isPending}
              onSave={(v) => save("lastUpdate", v)}
              placeholder="Qué pasó en el último contacto"
            />
          </Field>

          {row.stage === "PERDIDO" && (
            <Field label="Motivo de la pérdida">
              <EditableText
                value=""
                disabled={isPending}
                onSave={(v) => save("lostReason", v)}
                placeholder="Precio, tiempos, se fue con otro proveedor…"
              />
            </Field>
          )}

          <div className="rounded-lg border border-accent-dim/40 bg-accent/5 p-3">
            <p className="mb-2 flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent">
              <Sparkles size={11} /> Asesor IA
            </p>

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
          </div>

          {row.assignedTo && (
            <p className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: vendorColor(row.assignedTo.id) }}
              />
              {row.assignedTo.id === currentUserId ? "Tú" : row.assignedTo.name}
            </p>
          )}

          <div className="border-t border-border pt-4">
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
        </div>
      </aside>
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
