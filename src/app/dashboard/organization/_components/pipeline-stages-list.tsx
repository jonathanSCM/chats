"use client";

import { useState, useTransition } from "react";
import { ArrowUp, ArrowDown, Trash2, Plus, Lock } from "lucide-react";
import {
  createPipelineStageAction,
  renamePipelineStageAction,
  recolorPipelineStageAction,
  movePipelineStageAction,
  deletePipelineStageAction,
} from "@/server/actions/pipeline-stages";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VENDOR_COLOR_PALETTE } from "@/lib/vendor-color";

const ROLE_LABEL: Record<string, string> = {
  WON: "Ganado",
  LOST: "Perdido",
  NURTURE: "En pausa / Nutrir",
};

export interface StageRow {
  id: string;
  label: string;
  color: string;
  role: "WON" | "LOST" | "NURTURE" | null;
  isDefaultEntry: boolean;
  opportunityCount: number;
}

export function PipelineStagesList({ stages }: { stages: StageRow[] }) {
  const [newLabel, setNewLabel] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    const label = newLabel.trim();
    if (!label) return;
    setError(null);
    startTransition(async () => {
      const result = await createPipelineStageAction(label);
      if (result.error) setError(result.error);
      else setNewLabel("");
    });
  }

  return (
    <div className="space-y-3">
      <Table>
        <Thead>
          <tr>
            <Th />
            <Th>Etapa</Th>
            <Th>Clientes</Th>
            <Th />
          </tr>
        </Thead>
        <tbody>
          {stages.map((stage, i) => (
            <StageRowItem
              key={stage.id}
              stage={stage}
              allStages={stages}
              isFirst={i === 0}
              isLast={i === stages.length - 1}
            />
          ))}
        </tbody>
      </Table>

      <div className="flex items-center gap-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleCreate())}
          placeholder="Nombre de la etapa nueva"
          className="max-w-xs"
        />
        <Button type="button" variant="secondary" disabled={isPending || !newLabel.trim()} onClick={handleCreate}>
          <Plus size={14} /> Agregar
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function StageRowItem({
  stage,
  allStages,
  isFirst,
  isLast,
}: {
  stage: StageRow;
  allStages: StageRow[];
  isFirst: boolean;
  isLast: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState(stage.label);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  const [colorOpen, setColorOpen] = useState(false);

  const otherStages = allStages.filter((s) => s.id !== stage.id);

  function saveLabel() {
    const trimmed = label.trim();
    if (!trimmed || trimmed === stage.label) {
      setLabel(stage.label);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renamePipelineStageAction(stage.id, trimmed);
      if (result.error) {
        setError(result.error);
        setLabel(stage.label);
      }
    });
  }

  function pickColor(color: string) {
    setColorOpen(false);
    startTransition(async () => {
      await recolorPipelineStageAction(stage.id, color);
    });
  }

  function move(direction: "up" | "down") {
    setError(null);
    startTransition(async () => {
      const result = await movePipelineStageAction(stage.id, direction);
      if (result.error) setError(result.error);
    });
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deletePipelineStageAction(stage.id, reassignTo || undefined);
      if (result.error) {
        setError(result.error);
        setConfirmDelete(false);
      } else if (result.opportunityCount) {
        // Todavía no se borró: hace falta elegir a dónde van los clientes.
        setError(
          `Esta etapa tiene ${result.opportunityCount} cliente(s) — elegí a qué etapa se mueven antes de borrar.`,
        );
      } else {
        setConfirmDelete(false);
      }
    });
  }

  return (
    <Tr>
      <Td className="w-16">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isPending || isFirst}
            onClick={() => move("up")}
            className="text-ink-faint hover:text-ink disabled:opacity-30"
            title="Subir"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            disabled={isPending || isLast}
            onClick={() => move("down")}
            className="text-ink-faint hover:text-ink disabled:opacity-30"
            title="Bajar"
          >
            <ArrowDown size={14} />
          </button>
        </div>
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-2">
          <span className="relative inline-flex shrink-0">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setColorOpen((v) => !v)}
              className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded-full ring-offset-2 ring-offset-surface transition-shadow hover:ring-2 hover:ring-border-strong"
              style={{ backgroundColor: stage.color }}
              title="Cambiar color"
            />
            {colorOpen && (
              <>
                <button
                  type="button"
                  aria-label="Cerrar selector de color"
                  onClick={() => setColorOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="absolute left-0 top-6 z-20 flex w-[168px] flex-wrap gap-1.5 rounded-md border border-border bg-surface p-2.5 shadow-lg">
                  {VENDOR_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => pickColor(c)}
                      className="h-6 w-6 shrink-0 rounded-full transition-transform hover:scale-110"
                      style={{ backgroundColor: c, outline: c === stage.color ? "2px solid var(--ink)" : "none", outlineOffset: 2 }}
                      title={c}
                    />
                  ))}
                </div>
              </>
            )}
          </span>
          <input
            value={label}
            disabled={isPending}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={saveLabel}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            size={label.length || 1}
            className="min-w-[90px] shrink-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-ink hover:border-border focus:border-border-strong focus:outline-none"
          />
          {stage.role && (
            <span
              title={`Etapa de sistema: ${ROLE_LABEL[stage.role]} — no se puede borrar`}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-faint"
            >
              <Lock size={10} /> {ROLE_LABEL[stage.role]}
            </span>
          )}
          {stage.isDefaultEntry && (
            <span className="shrink-0 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-faint">
              Entrada de leads
            </span>
          )}
        </div>
      </Td>
      <Td className="text-ink-muted">{stage.opportunityCount}</Td>
      <Td className="w-40">
        <div className="space-y-1.5">
          {!stage.role && (
            <div className="flex items-center justify-end gap-2">
              {confirmDelete && stage.opportunityCount > 0 && (
                <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className="w-32 py-1 text-xs">
                  <option value="">Mover a…</option>
                  {otherStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              )}
              <button
                type="button"
                disabled={isPending || (confirmDelete && stage.opportunityCount > 0 && !reassignTo)}
                onClick={handleDelete}
                className={`cursor-pointer transition-colors disabled:opacity-30 ${
                  confirmDelete ? "text-danger" : "text-ink-faint hover:text-danger"
                }`}
                title={confirmDelete ? "¿Seguro? Toca de nuevo" : "Borrar etapa"}
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
          {error && <p className="text-right text-xs text-danger">{error}</p>}
        </div>
      </Td>
    </Tr>
  );
}
