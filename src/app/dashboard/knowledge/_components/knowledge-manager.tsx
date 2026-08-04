"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Plus, Pencil, Trash2, X, Eye, EyeOff } from "lucide-react";
import {
  createKnowledgeItemAction,
  updateKnowledgeItemAction,
  toggleKnowledgeItemAction,
  deleteKnowledgeItemAction,
} from "@/server/actions/knowledge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Category =
  | "SERVICE"
  | "PRICING"
  | "SCOPE"
  | "EXCLUSION"
  | "FAQ"
  | "POLICY"
  | "CASE_STUDY"
  | "QUALIFICATION"
  | "TONE";

const categoryLabel: Record<Category, string> = {
  SERVICE: "Servicio",
  PRICING: "Precios",
  SCOPE: "Alcance",
  EXCLUSION: "Exclusiones",
  FAQ: "Pregunta frecuente",
  POLICY: "Política",
  CASE_STUDY: "Caso de éxito",
  QUALIFICATION: "Guía de calificación",
  TONE: "Tono",
};

const categoryHint: Record<Category, string> = {
  SERVICE: "Qué hace, para quién y qué problema resuelve.",
  PRICING: "Precios aprobados o reglas para cotizar.",
  SCOPE: "Qué incluye normalmente y cuánto suele tardar.",
  EXCLUSION: "Lo que NO está incluido, para no prometer de más.",
  FAQ: "Pregunta del cliente y la respuesta oficial.",
  POLICY: "Formas de pago, garantías, condiciones.",
  CASE_STUDY: "Proyecto real que sirve de referencia.",
  QUALIFICATION: "Qué hay que averiguar antes de cotizar.",
  TONE: "Cómo se comunica la empresa.",
};

interface Item {
  id: string;
  category: Category;
  title: string;
  content: string;
  active: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export function KnowledgeManager({ items }: { items: Item[] }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Estables para que el efecto de cierre del formulario no se redispare.
  const closeCreate = useCallback(() => setCreating(false), []);
  const closeEdit = useCallback(() => setEditingId(null), []);

  const grouped = items.reduce<Record<string, Item[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {creating ? (
        <Card>
          <ItemForm onDone={closeCreate} />
        </Card>
      ) : (
        <Button type="button" onClick={() => setCreating(true)}>
          <Plus size={16} /> Agregar entrada
        </Button>
      )}

      {items.length === 0 && !creating && (
        <Card className="text-sm text-ink-muted">
          Todavía no hay nada cargado. Empieza por tus servicios y por lo que necesitas
          averiguar antes de cotizar.
        </Card>
      )}

      {Object.entries(grouped).map(([category, categoryItems]) => (
        <section key={category}>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
            {categoryLabel[category as Category]}
          </h2>
          <div className="space-y-2">
            {categoryItems.map((item) =>
              editingId === item.id ? (
                <Card key={item.id}>
                  <ItemForm item={item} onDone={closeEdit} />
                </Card>
              ) : (
                <ItemRow
                  key={item.id}
                  item={item}
                  onEdit={() => setEditingId(item.id)}
                />
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function ItemRow({ item, onEdit }: { item: Item; onEdit: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Card className={`py-3 ${item.active ? "" : "opacity-50"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-ink">{item.title}</p>
            {!item.active && <Badge tone="neutral">Oculta</Badge>}
          </div>
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-ink-muted">
            {item.content}
          </p>
          <p className="mt-1.5 font-mono text-[10px] text-ink-faint">
            v{item.version} · {new Date(item.updatedAt).toLocaleDateString("es")}
            {item.updatedBy && ` · ${item.updatedBy}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await toggleKnowledgeItemAction(item.id, !item.active);
              })
            }
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
            title={item.active ? "Ocultar de la IA" : "Mostrar a la IA"}
          >
            {item.active ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
            title="Editar"
          >
            <Pencil size={15} />
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
                await deleteKnowledgeItemAction(item.id);
              });
            }}
            className={`flex h-8 cursor-pointer items-center justify-center rounded-md px-2 transition-colors hover:bg-surface-2 ${
              confirmDelete ? "text-danger" : "text-ink-faint hover:text-danger"
            }`}
            title="Eliminar"
          >
            {confirmDelete ? (
              <span className="text-xs font-medium">¿Seguro?</span>
            ) : (
              <Trash2 size={15} />
            )}
          </button>
        </div>
      </div>
    </Card>
  );
}

function ItemForm({ item, onDone }: { item?: Item; onDone: () => void }) {
  const action = item
    ? updateKnowledgeItemAction.bind(null, item.id)
    : createKnowledgeItemAction;
  const [state, formAction, isPending] = useActionState(action, { error: null });
  const [category, setCategory] = useState<Category>(item?.category ?? "SERVICE");

  // Al guardar con éxito el server action devuelve `message`; ahí se cierra
  // el formulario. En efecto, no durante el render.
  const saved = Boolean(state.message) && !isPending;
  useEffect(() => {
    if (saved) onDone();
  }, [saved, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-display text-sm font-semibold text-ink">
          {item ? "Editar entrada" : "Nueva entrada"}
        </p>
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer text-ink-faint hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="category">Tipo</Label>
        <Select
          id="category"
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
        >
          {(Object.keys(categoryLabel) as Category[]).map((key) => (
            <option key={key} value={key}>
              {categoryLabel[key]}
            </option>
          ))}
        </Select>
        <p className="text-xs text-ink-faint">{categoryHint[category]}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="title">Título</Label>
        <Input
          id="title"
          name="title"
          defaultValue={item?.title}
          placeholder="Ej. Desarrollo de aplicaciones a medida"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="content">Contenido</Label>
        <Textarea
          id="content"
          name="content"
          defaultValue={item?.content}
          rows={6}
          placeholder="Escribe con detalle. Esto es lo que la IA va a usar como verdad."
          required
        />
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
