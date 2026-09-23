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
  History,
  Video,
  Copy,
  Pencil,
  Ban,
} from "lucide-react";
import {
  addConversationNoteAction,
  deleteConversationAction,
  deleteConversationNoteAction,
  pauseBotAction,
  resumeBotAction,
  setConversationStatusAction,
  setConversationTagsAction,
  transferConversationAction,
  updateContactAction,
} from "@/server/actions/conversation-panel";
import {
  createOpportunityAction,
  updateMeetingAction,
  cancelMeetingAction,
  deleteMeetingAction,
} from "@/server/actions/crm";
import { createMeetingFromConversationAction } from "@/server/actions/inbox-meetings";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { SERVICES } from "@/lib/pipeline";
import { vendorColor } from "@/lib/vendor-color";
import { scheduledAtToUtcHidden, utcIsoToLocalInputValue } from "@/lib/datetime-local";

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
      stage: string;
      open: boolean;
      estimatedValue: number | null;
      nextAction: string | null;
      nextActionAt: string | null;
      meetings: {
        id: string;
        title: string | null;
        scheduledAt: string;
        durationMinutes: number;
        status: string;
        meetingUrl: string | null;
        botEnabled: boolean;
      }[];
    }[];
  } | null;
  notes: {
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; name: string; color: string | null } | null;
  }[];
  team: { id: string; name: string }[];
  history: { label: string; at: string; actor: string }[];
  canCreateGoogleMeet: boolean;
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
  const [confirmDeleteNoteId, setConfirmDeleteNoteId] = useState<string | null>(null);
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

  function handleDeleteNote(noteId: string) {
    if (confirmDeleteNoteId !== noteId) {
      setConfirmDeleteNoteId(noteId);
      setTimeout(() => setConfirmDeleteNoteId((c) => (c === noteId ? null : c)), 3000);
      return;
    }
    setConfirmDeleteNoteId(null);
    run(() => deleteConversationNoteAction(noteId));
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

        {data.aiQualificationEnabled && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-surface-2/40 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs text-ink-muted">
              <BotIcon size={13} />
              {data.botPaused ? "Bot pausado en esta conversación" : "Bot respondiendo solo"}
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                run(() =>
                  data.botPaused ? resumeBotAction(conversationId) : pauseBotAction(conversationId),
                )
              }
              className="cursor-pointer whitespace-nowrap text-xs font-medium text-accent hover:underline"
            >
              {data.botPaused ? "Reactivar bot" : "Tomar control"}
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
                      <span>{o.stage}</span>
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

        {/* Reuniones */}
        {data.contact && (
          <MeetingsPanel
            conversationId={conversationId}
            meetings={data.contact.opportunities.flatMap((o) => o.meetings)}
            canCreateGoogleMeet={data.canCreateGoogleMeet}
            onChanged={() => {
              reload();
              onChanged();
            }}
          />
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
                    onClick={() => handleDeleteNote(note.id)}
                    className={`shrink-0 cursor-pointer ${
                      confirmDeleteNoteId === note.id ? "text-danger" : "text-ink-faint hover:text-danger"
                    }`}
                    title={confirmDeleteNoteId === note.id ? "¿Seguro? Toca de nuevo" : "Borrar nota"}
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

        {/* Historial: los movimientos del lead — cuándo entró, a qué etapa
            pasó, a quién quedó asignado. Consulta, no acción — texto chico
            y austero, no compite visualmente con el resto del panel. */}
        <div className="space-y-2 border-t border-border pt-4">
          <Label>
            <History size={11} className="mr-1 inline" /> Historial
          </Label>
          <div className="space-y-2.5 border-l border-border pl-3">
            {data.history.map((h, i) => (
              <div key={i} className="text-[11px]">
                <p className="text-ink-muted">{h.label}</p>
                <p className="text-ink-faint">
                  {new Date(h.at).toLocaleDateString("es", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {" · "}
                  {h.actor}
                </p>
              </div>
            ))}
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

  // Campos controlados en vez de defaultValue: un <form action={...}> de
  // React resetea solos los inputs no controlados cuando la acción termina
  // bien -- guardaba el dato pero la ficha se veía en blanco después de
  // "Guardar contacto" (el dato seguía en la base, solo la pantalla se
  // vaciaba). Se resincronizan cuando `contact` cambia (otro contacto, o
  // este mismo recargado con los valores ya guardados).
  const [fullName, setFullName] = useState(contact.fullName ?? "");
  const [city, setCity] = useState(contact.city ?? "");
  const [jobTitle, setJobTitle] = useState(contact.jobTitle ?? "");
  const [email, setEmail] = useState(contact.email ?? "");

  useEffect(() => {
    setFullName(contact.fullName ?? "");
    setCity(contact.city ?? "");
    setJobTitle(contact.jobTitle ?? "");
    setEmail(contact.email ?? "");
  }, [contact]);

  return (
    <form action={formAction} className="space-y-2 border-t border-border pt-4">
      <Label>Contacto</Label>
      <p className="font-mono text-[11px] text-ink-faint">{contact.phone}</p>

      <Input
        name="fullName"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="Nombre"
        className="py-1.5 text-xs"
      />
      <Input
        name="city"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder="Ciudad"
        className="py-1.5 text-xs"
      />
      <Input
        name="jobTitle"
        value={jobTitle}
        onChange={(e) => setJobTitle(e.target.value)}
        placeholder="Cargo"
        className="py-1.5 text-xs"
      />
      <Input
        name="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
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

type PanelMeeting = NonNullable<PanelData["contact"]>["opportunities"][number]["meetings"][number];

/**
 * "Añadir reunión" directo desde el chat -- antes solo se podía agendar una
 * reunión desde Seguimiento (y hacía falta primero agregar el contacto a
 * seguimiento a mano). Acá alcanza con completar la fecha: si el contacto
 * todavía no tiene una oportunidad abierta, se crea una sola sin que el
 * vendedor tenga que hacer ese paso aparte (ver createMeetingFromConversationAction).
 */
function MeetingsPanel({
  conversationId,
  meetings,
  canCreateGoogleMeet,
  onChanged,
}: {
  conversationId: string;
  meetings: PanelMeeting[];
  canCreateGoogleMeet: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [withGoogleMeet, setWithGoogleMeet] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [state, formAction] = useActionState(createMeetingFromConversationAction, { error: null });
  const [handledMessage, setHandledMessage] = useState<string | undefined>(undefined);
  if (state.message && state.message !== handledMessage) {
    setHandledMessage(state.message);
    setAdding(false);
    onChanged();
  }

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<{ id: string; message: string } | null>(null);
  function handleEditSubmit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setEditPending(true);
    setEditError(null);
    startTransition(async () => {
      const result = await updateMeetingAction(id, formData);
      setEditPending(false);
      if (result.error) setEditError({ id, message: result.error });
      else {
        setEditingId(null);
        onChanged();
      }
    });
  }

  const [cancelingId, setCancelingId] = useState<string | null>(null);
  function handleCancel(id: string) {
    if (cancelingId !== id) {
      setCancelingId(id);
      setTimeout(() => setCancelingId((c) => (c === id ? null : c)), 3000);
      return;
    }
    setCancelingId(null);
    startTransition(async () => {
      await cancelMeetingAction(id);
      onChanged();
    });
  }

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirmDeleteId(null);
    startTransition(async () => {
      await deleteMeetingAction(id);
      onChanged();
    });
  }

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <Label>
          <Video size={11} className="mr-1 inline" /> Reuniones
        </Label>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex cursor-pointer items-center gap-1 text-[11px] text-accent hover:opacity-80"
          >
            <Plus size={11} /> Añadir reunión
          </button>
        )}
      </div>

      {adding && (
        <form action={formAction} className="space-y-2 rounded-md border border-border p-2.5">
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="scheduledAt" />
          <Input
            type="text"
            name="title"
            placeholder="Nombre de la reunión (opcional)"
            className="py-1.5 text-xs"
          />
          <div className="flex gap-2">
            <Input
              type="datetime-local"
              required
              className="py-1.5 text-xs"
              onChange={scheduledAtToUtcHidden}
            />
            <Input
              type="number"
              name="durationMinutes"
              placeholder="min"
              min={1}
              className="w-20 py-1.5 text-xs"
            />
          </div>
          {canCreateGoogleMeet && (
            <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <input
                type="checkbox"
                name="withGoogleMeet"
                className="h-3.5 w-3.5"
                checked={withGoogleMeet}
                onChange={(e) => setWithGoogleMeet(e.target.checked)}
              />
              Crear con Google Meet (en tu calendario, genera el link automáticamente)
            </label>
          )}
          <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <input type="checkbox" name="botEnabled" className="h-3.5 w-3.5" defaultChecked />
            Que el bot se una a esta reunión
          </label>
          {canCreateGoogleMeet && withGoogleMeet && (
            <Input
              type="text"
              name="guestEmails"
              placeholder="Invitados (correos separados por coma)"
              className="py-1.5 text-xs"
            />
          )}
          <Input
            type="url"
            name="meetingUrl"
            placeholder="Pegá el link de la reunión (Meet, Zoom, etc.)"
            className="py-1.5 text-xs"
          />
          {state.error && <p className="text-[11px] text-danger">{state.error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="text-xs">
              Guardar reunión
            </Button>
            <Button type="button" size="sm" variant="secondary" className="text-xs" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {meetings.length === 0 ? (
        <p className="text-[11px] text-ink-faint">Todavía no hay reuniones registradas.</p>
      ) : (
        <div className="space-y-1.5">
          {meetings.map((m) => (
            <div key={m.id} className="rounded-md border border-border bg-surface px-2.5 py-2">
              {m.title && <p className="truncate text-xs font-medium text-ink">{m.title}</p>}
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-muted">
                <span className="font-mono">
                  {new Date(m.scheduledAt).toLocaleString("es", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {m.status}
                </span>
                {m.meetingUrl && (
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(m.meetingUrl!)}
                    title="Copiar link de la reunión"
                    className="flex cursor-pointer items-center gap-1 rounded border border-border px-1 py-0.5 hover:border-accent-dim hover:text-accent"
                  >
                    <Copy size={9} /> Link
                  </button>
                )}
                {m.status !== "CANCELED" && m.status !== "DONE" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditingId(editingId === m.id ? null : m.id)}
                      className={`flex cursor-pointer items-center gap-1 rounded border border-border px-1 py-0.5 hover:border-accent-dim hover:text-accent ${
                        editingId === m.id ? "border-accent-dim text-accent" : ""
                      }`}
                    >
                      <Pencil size={9} /> Editar
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleCancel(m.id)}
                      className="flex cursor-pointer items-center gap-1 rounded border border-border px-1 py-0.5 hover:border-danger hover:text-danger disabled:cursor-not-allowed"
                    >
                      <Ban size={9} /> {cancelingId === m.id ? "¿Seguro?" : "Cancelar"}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleDelete(m.id)}
                  className={`ml-auto cursor-pointer disabled:cursor-not-allowed ${
                    confirmDeleteId === m.id ? "text-danger" : "text-ink-faint hover:text-danger"
                  }`}
                  title={confirmDeleteId === m.id ? "¿Seguro? Toca de nuevo" : "Borrar reunión"}
                >
                  <Trash2 size={11} />
                </button>
              </div>

              {editingId === m.id && (
                <form
                  onSubmit={(e) => handleEditSubmit(m.id, e)}
                  className="mt-1.5 space-y-1.5 rounded-md border border-border bg-surface-2/40 p-2"
                >
                  <input type="hidden" name="scheduledAt" defaultValue={m.scheduledAt} />
                  <Input
                    type="text"
                    name="title"
                    placeholder="Nombre de la reunión"
                    defaultValue={m.title ?? ""}
                    className="py-1.5 text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Input
                      type="datetime-local"
                      required
                      defaultValue={utcIsoToLocalInputValue(m.scheduledAt)}
                      onChange={scheduledAtToUtcHidden}
                      className="py-1.5 text-xs"
                    />
                    <Input
                      type="number"
                      name="durationMinutes"
                      min={1}
                      defaultValue={m.durationMinutes}
                      className="w-20 py-1.5 text-xs"
                    />
                  </div>
                  <Input
                    type="url"
                    name="meetingUrl"
                    placeholder="Link de la reunión"
                    defaultValue={m.meetingUrl ?? ""}
                    className="py-1.5 text-xs"
                  />
                  <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                    <input type="checkbox" name="botEnabled" className="h-3.5 w-3.5" defaultChecked={m.botEnabled} />
                    Que el bot se una a esta reunión
                  </label>
                  {editError?.id === m.id && <p className="text-[11px] text-danger">{editError.message}</p>}
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" className="text-xs" disabled={editPending}>
                      {editPending ? "Guardando…" : "Guardar cambios"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => setEditingId(null)}
                    >
                      Cancelar edición
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
