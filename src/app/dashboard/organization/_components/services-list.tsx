"use client";

import { useState, useTransition } from "react";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import {
  createServiceAction,
  renameServiceAction,
  moveServiceAction,
  deleteServiceAction,
} from "@/server/actions/services-catalog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface ServiceRow {
  id: string;
  label: string;
}

export function ServicesList({ services }: { services: ServiceRow[] }) {
  const [newLabel, setNewLabel] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    const label = newLabel.trim();
    if (!label) return;
    setError(null);
    startTransition(async () => {
      const result = await createServiceAction(label);
      if (result.error) setError(result.error);
      else setNewLabel("");
    });
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {services.map((service, i) => (
          <ServiceRowItem
            key={service.id}
            service={service}
            isFirst={i === 0}
            isLast={i === services.length - 1}
          />
        ))}
        {services.length === 0 && (
          <li className="px-4 py-3 text-sm text-ink-faint">Todavía no hay ningún servicio cargado.</li>
        )}
      </ul>

      <div className="flex items-center gap-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleCreate())}
          placeholder="Nombre del servicio nuevo"
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

function ServiceRowItem({ service, isFirst, isLast }: { service: ServiceRow; isFirst: boolean; isLast: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState(service.label);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function saveLabel() {
    const trimmed = label.trim();
    if (!trimmed || trimmed === service.label) {
      setLabel(service.label);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameServiceAction(service.id, trimmed);
      if (result.error) {
        setError(result.error);
        setLabel(service.label);
      }
    });
  }

  function move(direction: "up" | "down") {
    setError(null);
    startTransition(async () => {
      const result = await moveServiceAction(service.id, direction);
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
      const result = await deleteServiceAction(service.id);
      if (result.error) {
        setError(result.error);
        setConfirmDelete(false);
      }
    });
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2">
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
      <input
        value={label}
        disabled={isPending}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={saveLabel}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        size={label.length || 1}
        className="min-w-[100px] flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-ink hover:border-border focus:border-border-strong focus:outline-none"
      />
      <button
        type="button"
        disabled={isPending}
        onClick={handleDelete}
        className={`cursor-pointer transition-colors disabled:opacity-30 ${
          confirmDelete ? "text-danger" : "text-ink-faint hover:text-danger"
        }`}
        title={confirmDelete ? "¿Seguro? Toca de nuevo" : "Borrar servicio"}
      >
        <Trash2 size={15} />
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </li>
  );
}
