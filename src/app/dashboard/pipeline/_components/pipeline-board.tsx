"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Plus, X, AlertTriangle, CalendarClock, CheckSquare } from "lucide-react";
import {
  createOpportunityAction,
  changeStageAction,
  setNextActionAction,
} from "@/server/actions/crm";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { STAGE_LABEL, STAGE_COLOR, STAGE_CRITERIA, isOpenStage, type Stage } from "@/lib/pipeline";
import { vendorColor } from "@/lib/vendor-color";

interface Opportunity {
  id: string;
  title: string;
  stage: Stage;
  estimatedValue: number | null;
  currency: string;
  leadScore: number | null;
  nextAction: string | null;
  nextActionAt: string | null;
  contact: { id: string; label: string };
  assignedTo: { id: string; name: string } | null;
}

interface Props {
  stages: Stage[];
  opportunities: Opportunity[];
  contacts: { id: string; label: string }[];
  currentUserId: string;
  pipelineValue: number;
  openCount: number;
  withoutNextAction: number;
  activitiesByOpportunity: Record<string, number>;
}

const money = new Intl.NumberFormat("es", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function PipelineBoard({
  stages,
  opportunities,
  contacts,
  currentUserId,
  pipelineValue,
  openCount,
  withoutNextAction,
  activitiesByOpportunity,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Opportunity | null>(null);

  const closeCreate = useCallback(() => setCreating(false), []);
  const closeDetail = useCallback(() => setSelected(null), []);

  const byStage = stages.map((stage) => ({
    stage,
    items: opportunities.filter((o) => o.stage === stage),
  }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Oportunidades abiertas" value={openCount.toString()} />
        <Stat label="Valor del embudo" value={money.format(pipelineValue)} />
        <Stat
          label="Sin próximo paso"
          value={withoutNextAction.toString()}
          warning={withoutNextAction > 0}
        />
        <div className="flex items-end">
          {creating ? null : (
            <Button type="button" onClick={() => setCreating(true)} className="w-full">
              <Plus size={16} /> Nueva oportunidad
            </Button>
          )}
        </div>
      </div>

      {withoutNextAction > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-dim px-3 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Hay {withoutNextAction} oportunidad{withoutNextAction === 1 ? "" : "es"} activa
            {withoutNextAction === 1 ? "" : "s"} sin próximo paso. Toda oportunidad viva
            debería tener uno definido.
          </span>
        </div>
      )}

      {creating && (
        <Card>
          <CreateForm contacts={contacts} onDone={closeCreate} />
        </Card>
      )}

      {opportunities.length === 0 && !creating && (
        <Card className="text-sm text-ink-muted">
          Todavía no hay oportunidades. Crea una desde un contacto que ya escribió por
          WhatsApp.
        </Card>
      )}

      {/* Tablero: scroll horizontal por etapas, cada columna con sus tarjetas */}
      <div className="-mx-4 overflow-x-auto px-4 md:-mx-8 md:px-8">
        <div className="flex min-w-max gap-3 pb-3">
          {byStage.map(({ stage, items }) => (
            <section key={stage} className="w-64 shrink-0">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: STAGE_COLOR[stage] }}
                />
                <h2 className="truncate font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                  {STAGE_LABEL[stage]}
                </h2>
                <span className="ml-auto font-mono text-[11px] text-ink-faint">
                  {items.length}
                </span>
              </div>

              <div className="space-y-2">
                {items.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setSelected(o)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <p className="truncate text-sm font-medium text-ink">{o.title}</p>
                    <p className="truncate text-xs text-ink-muted">{o.contact.label}</p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                      {o.estimatedValue !== null && (
                        <span className="font-mono text-ink-muted">
                          {money.format(o.estimatedValue)}
                        </span>
                      )}
                      {o.leadScore !== null && (
                        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-ink-muted">
                          {o.leadScore}
                        </span>
                      )}
                      {activitiesByOpportunity[o.id] > 0 && (
                        <span className="flex items-center gap-0.5 text-ink-faint">
                          <CheckSquare size={10} /> {activitiesByOpportunity[o.id]}
                        </span>
                      )}
                    </div>

                    {isOpenStage(o.stage) && !o.nextAction && (
                      <p className="mt-1.5 flex items-center gap-1 text-[10px] text-warning">
                        <AlertTriangle size={10} /> sin próximo paso
                      </p>
                    )}
                    {o.nextAction && (
                      <p className="mt-1.5 flex items-start gap-1 text-[10px] text-ink-faint">
                        <CalendarClock size={10} className="mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{o.nextAction}</span>
                      </p>
                    )}

                    {o.assignedTo && (
                      <span className="mt-1.5 flex items-center gap-1 text-[10px] text-ink-faint">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: vendorColor(o.assignedTo.id) }}
                        />
                        {o.assignedTo.id === currentUserId ? "Tú" : o.assignedTo.name}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {selected && <DetailPanel opportunity={selected} onClose={closeDetail} />}
    </div>
  );
}

function Stat({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <Card className="py-3">
      <CardDescription className="mb-1 font-mono text-[10px] uppercase tracking-wide">
        {label}
      </CardDescription>
      <CardTitle className={`font-mono text-xl ${warning ? "text-warning" : ""}`}>
        {value}
      </CardTitle>
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
        <p className="font-display text-sm font-semibold text-ink">Nueva oportunidad</p>
        <button type="button" onClick={onDone} className="cursor-pointer text-ink-faint hover:text-ink">
          <X size={16} />
        </button>
      </div>

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
        <Label htmlFor="title">Título</Label>
        <Input id="title" name="title" placeholder="Ej. Sitio web para la clínica" required />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="serviceInterest">Servicio de interés</Label>
          <Input id="serviceInterest" name="serviceInterest" placeholder="Opcional" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="estimatedValue">Valor estimado (USD)</Label>
          <Input id="estimatedValue" name="estimatedValue" type="number" min="0" step="1" placeholder="Opcional" />
        </div>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creando…" : "Crear"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function DetailPanel({
  opportunity,
  onClose,
}: {
  opportunity: Opportunity;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [stage, setStage] = useState<Stage>(opportunity.stage);

  const [nextState, nextAction, nextPending] = useActionState(
    setNextActionAction.bind(null, opportunity.id),
    { error: null },
  );

  function applyStage(newStage: Stage) {
    setError(null);
    if (newStage === "LOST" && !lostReason.trim()) {
      setStage(newStage);
      setError("Indica el motivo de la pérdida antes de guardar.");
      return;
    }
    startTransition(async () => {
      const result = await changeStageAction(opportunity.id, newStage, lostReason || undefined);
      if (result.error) setError(result.error);
      else onClose();
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
      <aside className="relative flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-ink">{opportunity.title}</h2>
            <p className="truncate text-sm text-ink-muted">{opportunity.contact.label}</p>
          </div>
          <button type="button" onClick={onClose} className="cursor-pointer text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="stage">Etapa</Label>
            <Select
              id="stage"
              value={stage}
              disabled={isPending}
              onChange={(e) => {
                const next = e.target.value as Stage;
                setStage(next);
                if (next !== "LOST") applyStage(next);
              }}
            >
              {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-ink-faint">{STAGE_CRITERIA[stage]}</p>
          </div>

          {stage === "LOST" && (
            <div className="space-y-1.5">
              <Label htmlFor="lostReason">Motivo de la pérdida</Label>
              <Textarea
                id="lostReason"
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                rows={3}
                placeholder="Precio, tiempos, se fue con otro proveedor, no era el momento…"
              />
              <Button type="button" disabled={isPending} onClick={() => applyStage("LOST")}>
                Marcar como perdida
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <form action={nextAction} className="space-y-3 border-t border-border pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="nextAction">Próximo paso</Label>
              <Input
                id="nextAction"
                name="nextAction"
                defaultValue={opportunity.nextAction ?? ""}
                placeholder="Ej. Llamar para confirmar presupuesto"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nextActionAt">¿Cuándo?</Label>
              <Input
                id="nextActionAt"
                name="nextActionAt"
                type="datetime-local"
                defaultValue={opportunity.nextActionAt?.slice(0, 16) ?? ""}
              />
              <p className="text-xs text-ink-faint">
                Con fecha se crea una tarea y entra en los recordatorios.
              </p>
            </div>

            {nextState.error && <p className="text-sm text-danger">{nextState.error}</p>}

            <Button type="submit" variant="secondary" disabled={nextPending}>
              {nextPending ? "Guardando…" : "Guardar próximo paso"}
            </Button>
          </form>
        </div>
      </aside>
    </div>
  );
}
