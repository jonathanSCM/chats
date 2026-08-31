"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  StickyNote,
  Trash2,
  UserCog,
  Tag as TagIcon,
  Briefcase,
  AlertTriangle,
  Plus,
  Bot as BotIcon,
} from "lucide-react";
import {
  addConversationNoteAction,
  deleteConversationAction,
  deleteConversationNoteAction,
  resumeBotAction,
  setConversationStatusAction,
  setConversationTagsAction,
  transferConversationAction,
  updateContactAction,
} from "@/server/actions/conversation-panel";
import { createOpportunityAction } from "@/server/actions/crm";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { STAGE_LABEL, SERVICES, type Stage } from "@/lib/pipeline";
import { vendorColor } from "@/lib/vendor-color";

interface PanelData {
  status: "OPEN" | "ON_HOLD" | "CLOSED";
  tags: string[];
  assignedToId: string | null;
  botPaused: boolean;
  aiQualificationEnabled: boolean;
  contact: {
    id: string;
    fullName: string | null;
    phone: string;
    email: string | null;
    city: string | null;
    jobTitle: string | null;
    company: { id: string; name: string } | null;
    opportunities: {
      id: string;
      title: string;
      stage: Stage;
      open: boolean;
      estimatedValue: number | null;
      nextAction: string | null;
      nextActionAt: string | null;
    }[];
  } | null;
  notes: {
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; name: string; color: string | null } | null;
  }[];
  team: { id: string; name: string }[];
}

const STATUS_LABEL = {
  OPEN: "Abierta",
  ON_HOLD: "En pausa",
  CLOSED: "Cerrada",
} as const;

// Las que el equipo ya usa en su planilla; se pueden escribir otras.
const SUGGESTED_TAGS = ["AGENTES IA", "SISTEMAS", "APP", "TAXI"];

const money = new Intl.NumberFormat("es", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function ConversationPanel({
  conversationId,
  currentUserId,
  isAdmin,
  onClose,
  onChanged,
  onDeleted,
}: {
  conversationId: string;
  currentUserId: string;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<PanelData | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingToTracking, setAddingToTracking] = useState(false);

  // Se recarga subiendo el token en vez de llamar a una función que haga
  // setState: así el fetch vive dentro del efecto y se cancela al desmontar.
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/inbox/conversations/${conversationId}/panel`);
        if (cancelled) return;
        if (!res.ok) {
          setError("No se pudo cargar la ficha.");
          return;
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError("No se pudo cargar la ficha.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, reloadToken]);

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else {
        reload();
        onChanged();
      }
    });
  }

  function handleDeleteConversation() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteConversationAction(conversationId);
      if (result.error) setError(result.error);
      else onDeleted();
    });
  }

  if (!data) {
    return (
      <aside className="w-full shrink-0 border-l border-border bg-surface/60 p-4 lg:w-80">
        <p className="text-sm text-ink-faint">Cargando ficha…</p>
      </aside>
    );
  }

  const openOpportunities = data.contact?.opportunities.filter((o) => o.open) ?? [];

  return (
    <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-l border-border bg-surface/60 lg:w-80">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface/90 px-4 py-3 backdrop-blur">
        <h2 className="font-display text-sm font-semibold text-ink">Ficha</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar ficha"
          className="cursor-pointer text-ink-faint hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-5 px-4 py-4">
        {error && <p className="text-xs text-danger">{error}</p>}

        {/* Estado y asignación */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="status">Estado</Label>
            <Select
              id="status"
              value={data.status}
              disabled={isPending}
              onChange={(e) =>
                run(() =>
                  setConversationStatusAction(
                    conversationId,
                    e.target.value as PanelData["status"],
                  ),
                )
              }
            >
              {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assignee">
              <UserCog size={11} className="mr-1 inline" /> Vendedor
            </Label>
            <Select
              id="assignee"
              value={data.assignedToId ?? ""}
              disabled={isPending}
              onChange={(e) =>
                run(() => transferConversationAction(conversationId, e.target.value || null))
              }
            >
              <option value="">Sin asignar</option>
              {(isAdmin ? data.team : data.team.filter((u) => u.id === currentUserId)).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === currentUserId ? `${u.name} (tú)` : u.name}
                </option>
              ))}
            </Select>
            {!isAdmin && (
              <p className="text-[11px] text-ink-faint">
                Puedes tomar o soltar esta conversación. Para pasarla a otro compañero, pídeselo al
                dueño de la organización.
              </p>
            )}
          </div>
        </div>

        {data.aiQualificationEnabled && data.botPaused && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-surface-2/40 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs text-ink-muted">
              <BotIcon size={13} />
              Bot pausado en esta conversación
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => resumeBotAction(conversationId))}
              className="cursor-pointer whitespace-nowrap text-xs font-medium text-accent hover:underline"
            >
              Reactivar bot
            </button>
          </div>
        )}

        {/* Etiquetas */}
        <div className="space-y-2 border-t border-border pt-4">
          <Label>
            <TagIcon size={11} className="mr-1 inline" /> Etiquetas
          </Label>

          <div className="flex flex-wrap gap-1.5">
            {data.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(() =>
                    setConversationTagsAction(
                      conversationId,
                      data.tags.filter((t) => t !== tag),
                    ),
                  )
                }
                className="group flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted hover:bg-danger-dim hover:text-danger"
                title="Quitar etiqueta"
              >
                {tag}
                <X size={10} className="opacity-0 group-hover:opacity-100" />
              </button>
            ))}
            {data.tags.length === 0 && (
              <span className="text-[11px] text-ink-faint">Sin etiquetas</span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_TAGS.filter((t) => !data.tags.includes(t)).map((tag) => (
              <button
                key={tag}
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(() => setConversationTagsAction(conversationId, [...data.tags, tag]))
                }
                className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-ink-faint hover:border-accent-dim hover:text-ink"
              >
                + {tag}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newTag.trim()) return;
              run(() => setConversationTagsAction(conversationId, [...data.tags, newTag]));
              setNewTag("");
            }}
          >
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Otra etiqueta y Enter"
              className="py-1.5 text-xs"
            />
          </form>
        </div>

        {/* Contacto */}
        {data.contact && (
          <ContactForm
            contact={data.contact}
            onSaved={() => {
              reload();
              onChanged();
            }}
          />
        )}

        {/* Oportunidades */}
        {data.contact && (
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-2">
              <Label>
                <Briefcase size={11} className="mr-1 inline" /> En seguimiento
              </Label>
              {!addingToTracking && (
                <button
                  type="button"
                  onClick={() => setAddingToTracking(true)}
                  className="flex cursor-pointer items-center gap-1 text-[11px] text-accent hover:opacity-80"
                >
                  <Plus size={11} /> Agregar
                </button>
              )}
            </div>

            {addingToTracking && (
              <AddToTrackingForm
                contactId={data.contact.id}
                customerName={data.contact.fullName}
                onCancel={() => setAddingToTracking(false)}
                onCreated={(opportunityId) => {
                  router.push(`/dashboard/seguimiento?open=${opportunityId}`);
                }}
              />
            )}

            {data.contact.opportunities.length === 0 ? (
              <p className="text-[11px] text-ink-faint">Ninguno todavía.</p>
            ) : (
              <div className="space-y-1.5">
                {data.contact.opportunities.map((o) => (
                  <div
                    key={o.id}
                    className="rounded-md border border-border bg-surface px-2.5 py-2"
                  >
                    <p className="truncate text-xs font-medium text-ink">{o.title}</p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-muted">
                      <span>{STAGE_LABEL[o.stage]}</span>
                      {o.estimatedValue !== null && (
                        <span className="font-mono">{money.format(o.estimatedValue)}</span>
                      )}
                    </div>
                    {o.open && !o.nextAction && (
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-warning">
                        <AlertTriangle size={10} /> sin próximo paso
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {openOpportunities.length === 0 && data.contact.opportunities.length > 0 && (
              <p className="text-[10px] text-ink-faint">Ninguna abierta.</p>
            )}
          </div>
        )}

        {/* Notas internas */}
        <div className="space-y-2 border-t border-border pt-4">
          <Label>
            <StickyNote size={11} className="mr-1 inline" /> Notas internas
          </Label>
          <p className="text-[10px] text-ink-faint">
            Solo las ve el equipo. No se envían al cliente.
          </p>

          <NoteForm conversationId={conversationId} onSaved={reload} />

          <div className="space-y-2">
            {data.notes.map((note) => (
              <div key={note.id} className="rounded-md bg-surface-2/60 px-2.5 py-2">
                <p className="whitespace-pre-wrap text-xs text-ink">{note.body}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-[10px] text-ink-faint">
                    {note.author && (
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: vendorColor(note.author.id, note.author.color) }}
                      />
                    )}
                    {note.author?.name ?? "Sistema"} ·{" "}
                    {new Date(note.createdAt).toLocaleDateString("es", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => deleteConversationNoteAction(note.id))}
                    className="shrink-0 cursor-pointer text-ink-faint hover:text-danger"
                    title="Borrar nota"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            {data.notes.length === 0 && (
              <p className="text-[11px] text-ink-faint">Todavía no hay notas.</p>
            )}
          </div>
        </div>

        {/* Zona peligrosa */}
        <div className="border-t border-border pt-4">
          <button
            type="button"
            disabled={isPending}
            onClick={handleDeleteConversation}
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-danger/30 px-3 py-2 text-xs text-danger transition-colors hover:bg-danger-dim disabled:opacity-50"
          >
            <Trash2 size={13} />
            {confirmDelete ? "¿Seguro? Toca de nuevo — se borra todo" : "Eliminar chat"}
          </button>
        </div>
      </div>
    </aside>
  );
}

function NoteForm({
  conversationId,
  onSaved,
}: {
  conversationId: string;
  onSaved: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    addConversationNoteAction.bind(null, conversationId),
    { error: null },
  );
  const saved = Boolean(state.message) && !isPending;

  useEffect(() => {
    if (saved) onSaved();
  }, [saved, onSaved]);

  return (
    <form action={formAction} className="space-y-1.5" key={state.message ?? "new"}>
      <Textarea
        name="body"
        rows={2}
        placeholder="Ej. Pidió más tiempo, retomar el viernes."
        className="min-h-0 text-xs"
        required
      />
      {state.error && <p className="text-[11px] text-danger">{state.error}</p>}
      <Button type="submit" variant="secondary" disabled={isPending} className="w-full py-1.5 text-xs">
        {isPending ? "Guardando…" : "Agregar nota"}
      </Button>
    </form>
  );
}

function AddToTrackingForm({
  contactId,
  customerName,
  onCancel,
  onCreated,
}: {
  contactId: string;
  customerName: string | null;
  onCancel: () => void;
  onCreated: (opportunityId: string) => void;
}) {
  const [state, formAction, isPending] = useActionState(createOpportunityAction, { error: null });

  useEffect(() => {
    if (state.opportunityId) onCreated(state.opportunityId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe correr cuando llega el id nuevo
  }, [state.opportunityId]);

  return (
    <form action={formAction} className="space-y-2 rounded-md border border-accent-dim/40 bg-accent/5 p-2.5">
      <input type="hidden" name="contactId" value={contactId} />
      <div className="space-y-1">
        <Label>Servicio</Label>
        <Select name="serviceInterest" defaultValue="" className="py-1.5 text-xs">
          <option value="">Sin definir</option>
          {SERVICES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Necesidad / contexto</Label>
        <Input
          name="title"
          defaultValue={customerName ? `${customerName} — ` : ""}
          placeholder="Qué necesita este cliente"
          className="py-1.5 text-xs"
          required
        />
      </div>
      {state.error && <p className="text-[11px] text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending} className="flex-1 py-1.5 text-xs">
          {isPending ? "Agregando…" : "Agregar y ver"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="py-1.5 text-xs">
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function ContactForm({
  contact,
  onSaved,
}: {
  contact: NonNullable<PanelData["contact"]>;
  onSaved: () => void;
}) {
  const [state, formAction, isPending] = useActionState(
    updateContactAction.bind(null, contact.id),
    { error: null },
  );
  const saved = Boolean(state.message) && !isPending;

  useEffect(() => {
    if (saved) onSaved();
  }, [saved, onSaved]);

  return (
    <form action={formAction} className="space-y-2 border-t border-border pt-4">
      <Label>Contacto</Label>
      <p className="font-mono text-[11px] text-ink-faint">{contact.phone}</p>

      <Input
        name="fullName"
        defaultValue={contact.fullName ?? ""}
        placeholder="Nombre"
        className="py-1.5 text-xs"
      />
      <Input
        name="city"
        defaultValue={contact.city ?? ""}
        placeholder="Ciudad"
        className="py-1.5 text-xs"
      />
      <Input
        name="jobTitle"
        defaultValue={contact.jobTitle ?? ""}
        placeholder="Cargo"
        className="py-1.5 text-xs"
      />
      <Input
        name="email"
        type="email"
        defaultValue={contact.email ?? ""}
        placeholder="Correo"
        className="py-1.5 text-xs"
      />

      {state.error && <p className="text-[11px] text-danger">{state.error}</p>}

      <Button
        type="submit"
        variant="secondary"
        disabled={isPending}
        className="w-full py-1.5 text-xs"
      >
        {isPending ? "Guardando…" : "Guardar contacto"}
      </Button>
    </form>
  );
}
