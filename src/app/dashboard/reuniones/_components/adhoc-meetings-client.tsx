"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Plus, X, Copy, Trash2, Clock, Video, Zap, PhoneOff, FileDown, Pencil, Ban, Search, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  createAdhocMeetingAction,
  deleteAdhocMeetingAction,
  joinMeetingNowAction,
  stopMeetingBotAction,
  generateMeetingSummaryPdfAction,
  updateAdhocMeetingAction,
  renameAdhocMeetingAction,
  cancelAdhocMeetingAction,
  searchClientsForMeetingAction,
  linkMeetingToOpportunityAction,
  createClientAndLinkMeetingAction,
  type ClientSearchResult,
} from "@/server/actions/adhoc-meetings";
import { scheduledAtToUtcHidden, utcIsoToLocalInputValue } from "@/lib/datetime-local";
import { BOT_STATUS_CONFIG } from "@/lib/meeting-bot-status";
import { MeetingAttachments, type MeetingAttachmentInfo } from "@/components/meeting-attachments";
import { PdfViewerModal } from "@/components/pdf-viewer-modal";
import { EditableTitle } from "@/components/editable-title";
import { SidePanel, PanelSection } from "@/components/side-panel";
import { panelAccent, PILL_BUTTON, hasMeetingEnded } from "@/lib/meeting-panel-ui";

export interface AdhocMeetingRow {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  meetingUrl: string | null;
  status: string;
  botStatus: string | null;
  botJoinedAt: string | null;
  botLeftAt: string | null;
  botEnabled: boolean;
  notes: string;
  transcript: string;
  audioTranscript: string;
  aiSummary: string;
  attachments: MeetingAttachmentInfo[];
}

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Agendada",
  CONFIRMED: "Confirmada",
  DONE: "Realizada",
  CANCELED: "Cancelada",
  NO_SHOW: "No se presentó",
};

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


/**
 * Buscador + "crear cliente nuevo" para vincular una reunión suelta a un
 * cliente -- vive en el panel de detalle, separado del componente principal
 * porque tiene su propio estado de búsqueda/formulario que no le interesa
 * al resto de la lista.
 */
function LinkClientSection({ meetingId, disabled }: { meetingId: string; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      startTransition(async () => {
        const found = await searchClientsForMeetingAction(value);
        setResults(found);
        setSearching(false);
      });
    }, 300);
  }

  function handleLink(opportunityId: string) {
    setError(null);
    startTransition(async () => {
      const result = await linkMeetingToOpportunityAction(meetingId, opportunityId);
      if (result.error) setError(result.error);
    });
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createClientAndLinkMeetingAction(meetingId, formData);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint" />
        <Input
          type="text"
          placeholder="Buscar cliente por nombre o teléfono…"
          value={query}
          disabled={disabled || isPending}
          onChange={(e) => handleQueryChange(e.target.value)}
          className="pl-8 text-sm"
        />
      </div>

      {searching && <p className="text-xs text-ink-faint">Buscando…</p>}
      {!searching && results.length > 0 && (
        <ul className="space-y-1">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={disabled || isPending}
                onClick={() => handleLink(r.id)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-left text-xs hover:border-accent-dim hover:bg-accent-dim/10 disabled:cursor-not-allowed"
              >
                <span className="truncate font-medium text-ink">{r.title}</span>
                <span className="shrink-0 text-ink-faint">{r.contactName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!searching && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-xs text-ink-faint">Sin resultados.</p>
      )}

      {creating ? (
        <form onSubmit={handleCreate} className="animate-fade-up space-y-2 rounded-lg border border-border bg-surface-2/60 p-3">
          <Input type="text" name="contactName" placeholder="Nombre del cliente" className="text-sm" />
          <Input type="text" name="contactPhone" placeholder="Teléfono" required className="text-sm" />
          <Input type="text" name="opportunityTitle" placeholder="Título de la oportunidad (opcional)" className="text-sm" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Creando…" : "Crear y vincular"}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          disabled={disabled || isPending}
          onClick={() => setCreating(true)}
          className={`${PILL_BUTTON} border-border text-ink-muted hover:border-accent-dim hover:text-accent`}
        >
          <UserPlus size={11} /> Cliente nuevo
        </button>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function AdhocMeetingsClient({ meetings }: { meetings: AdhocMeetingRow[] }) {
  const [adding, setAdding] = useState(false);
  const [withGoogleMeet, setWithGoogleMeet] = useState(false);
  const [state, formAction] = useActionState(createAdhocMeetingAction, { error: null });
  const [handledMessage, setHandledMessage] = useState<string | undefined>(undefined);
  if (state.message && state.message !== handledMessage) {
    setHandledMessage(state.message);
    setAdding(false);
  }

  // "Unir el bot ya mismo" — para cuando ya estás adentro de una reunión en
  // vivo, sin pasar por el formulario de agendar.
  const [joinNowState, joinNowFormAction] = useActionState(joinMeetingNowAction, { error: null });
  const [handledJoinNowMessage, setHandledJoinNowMessage] = useState<string | undefined>(undefined);
  if (joinNowState.message && joinNowState.message !== handledJoinNowMessage) {
    setHandledJoinNowMessage(joinNowState.message);
  }

  const [isPending, startTransition] = useTransition();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirmDeleteId(null);
    startTransition(async () => {
      await deleteAdhocMeetingAction(id);
    });
  }

  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [stopError, setStopError] = useState<{ id: string; message: string } | null>(null);
  function handleStop(id: string) {
    setStoppingId(id);
    setStopError(null);
    startTransition(async () => {
      const result = await stopMeetingBotAction(id);
      setStoppingId(null);
      if (result.error) setStopError({ id, message: result.error });
    });
  }

  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  function handleGenerateSummary(id: string) {
    setActionPendingId(id);
    setActionError(null);
    startTransition(async () => {
      const result = await generateMeetingSummaryPdfAction(id);
      setActionPendingId(null);
      if (result.error) setActionError({ id, message: result.error });
    });
  }

  const [viewingPdf, setViewingPdf] = useState<{ url: string; title: string } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<{ id: string; message: string } | null>(null);
  function handleEditSubmit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setEditPending(true);
    setEditError(null);
    startTransition(async () => {
      const result = await updateAdhocMeetingAction(id, formData);
      setEditPending(false);
      if (result.error) setEditError({ id, message: result.error });
      else setEditingId(null);
    });
  }

  function handleRename(id: string, title: string) {
    startTransition(async () => {
      await renameAdhocMeetingAction(id, title);
    });
  }

  const [detailId, setDetailId] = useState<string | null>(null);

  const [cancelingId, setCancelingId] = useState<string | null>(null);
  function handleCancelMeeting(id: string) {
    if (cancelingId !== id) {
      setCancelingId(id);
      setTimeout(() => setCancelingId((c) => (c === id ? null : c)), 3000);
      return;
    }
    setCancelingId(null);
    startTransition(async () => {
      await cancelAdhocMeetingAction(id);
    });
  }

  return (
    <div className="space-y-4">
      <Card className="border-accent-dim/40 bg-accent-dim/10">
        <form action={joinNowFormAction} className="flex flex-wrap items-end gap-2.5">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent">
              <Zap size={12} /> Unir el bot ya mismo
            </label>
            <Input type="url" name="meetingUrl" placeholder="Pegá el link de la reunión en la que estás" required className="text-sm" />
          </div>
          <Button type="submit" size="sm">
            Unir bot ahora
          </Button>
          {joinNowState.error && <p className="w-full text-xs text-danger">{joinNowState.error}</p>}
          {joinNowState.message && (
            <p className="w-full text-xs text-accent">{joinNowState.message}</p>
          )}
        </form>
      </Card>

      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Reuniones internas
        </p>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="flex cursor-pointer items-center gap-1 text-xs text-accent hover:opacity-80"
        >
          {adding ? (
            <>
              <X size={13} /> Cancelar
            </>
          ) : (
            <>
              <Plus size={13} /> Nueva reunión
            </>
          )}
        </button>
      </div>

      {adding && (
        <Card>
          <form action={formAction} className="space-y-2.5">
            <Input name="title" placeholder="Ej. Reunión de emergencia con el equipo" required className="text-sm" />
            <input type="hidden" name="scheduledAt" />
            <div className="flex gap-2">
              <Input type="datetime-local" required className="text-sm" onChange={scheduledAtToUtcHidden} />
              <Input type="number" name="durationMinutes" placeholder="min" min={1} className="w-24 text-sm" />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <input
                type="checkbox"
                name="withGoogleMeet"
                className="h-3.5 w-3.5"
                checked={withGoogleMeet}
                onChange={(e) => setWithGoogleMeet(e.target.checked)}
              />
              Crear con Google Meet (genera el link automáticamente)
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <input type="checkbox" name="botEnabled" className="h-3.5 w-3.5" defaultChecked />
              Que el bot se una a esta reunión (grabe y transcriba)
            </label>
            {withGoogleMeet && (
              <Input
                type="text"
                name="guestEmails"
                placeholder="Invitados (correos separados por coma) — Calendar les manda la invitación"
                className="text-sm"
              />
            )}
            <Input type="url" name="meetingUrl" placeholder="o pegá un link de reunión manualmente" className="text-sm" />
            {state.error && <p className="text-xs text-danger">{state.error}</p>}
            <Button type="submit" size="sm">
              Crear reunión
            </Button>
          </form>
        </Card>
      )}

      {meetings.length === 0 ? (
        <Card className="text-sm text-ink-muted">
          Todavía no hay reuniones internas. Se usan para juntadas de emergencia con el equipo, la
          dirección, etc. — no pasan por Seguimiento ni quedan atadas a ningún cliente.
        </Card>
      ) : (
        <div className="space-y-2">
          {meetings.map((m) => {
            const botConfig = m.botStatus ? BOT_STATUS_CONFIG[m.botStatus] : null;
            const BotIcon = botConfig?.icon;
            const live = m.botStatus === "JOINING" || m.botStatus === "RECORDING";
            return (
              <Card
                key={m.id}
                onClick={() => setDetailId(m.id)}
                style={{ borderLeftColor: panelAccent(m.botStatus), borderLeftWidth: 3 }}
                className="flex cursor-pointer items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <EditableTitle
                    value={m.title}
                    onSave={(v) => handleRename(m.id, v)}
                    disabled={isPending}
                    className="text-base font-semibold text-ink"
                  />
                  <p className="flex items-center gap-1.5 font-mono text-sm text-ink-muted">
                    <Clock size={14} className="shrink-0 text-ink-faint" />
                    {timeLabel(m.scheduledAt)} · {m.durationMinutes} min
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                      {STATUS_LABEL[m.status] ?? m.status}
                    </span>
                    {botConfig && BotIcon && (
                      <span
                        data-active={live}
                        className={`corner-brackets flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] ${botConfig.className}`}
                      >
                        {live && <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-current" />}
                        <BotIcon size={10} className={m.botStatus === "JOINING" || m.botStatus === "TRANSCRIBING" ? "animate-spin" : ""} />
                        {botConfig.label}
                      </span>
                    )}
                  </div>
                  {botConfig?.canStop && (
                    <button
                      type="button"
                      disabled={isPending || stoppingId === m.id}
                      onClick={() => handleStop(m.id)}
                      title="Sacar al bot de la reunión ahora"
                      className={`${PILL_BUTTON} border-danger/30 text-danger hover:border-danger hover:bg-danger/10`}
                    >
                      <PhoneOff size={11} /> {stoppingId === m.id ? "Deteniendo…" : "Detener bot"}
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {detailId && (() => {
        const m = meetings.find((x) => x.id === detailId);
        if (!m) return null;
        const botConfig = m.botStatus ? BOT_STATUS_CONFIG[m.botStatus] : null;
        const BotIcon = botConfig?.icon;
        const pdfAttachment = m.attachments.find((a) => a.mimeType === "application/pdf");
        return (
          <SidePanel
            onClose={() => setDetailId(null)}
            accent={panelAccent(m.botStatus)}
            header={
              <>
                <EditableTitle
                  value={m.title}
                  onSave={(v) => handleRename(m.id, v)}
                  disabled={isPending}
                  className="font-display text-2xl font-semibold tracking-tight text-ink"
                />
                <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[13px] text-ink-faint">
                  <Clock size={13} className="text-accent" /> {timeLabel(m.scheduledAt)} · {m.durationMinutes} min
                </p>
              </>
            }
          >
            <PanelSection label="Estado">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10px] text-ink-muted">
                  {STATUS_LABEL[m.status] ?? m.status}
                </span>
                {botConfig && BotIcon && (
                  <span
                    data-active={m.botStatus === "JOINING" || m.botStatus === "RECORDING" || m.botStatus === "TRANSCRIBING"}
                    className={`corner-brackets flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10px] ${botConfig.className}`}
                  >
                    <BotIcon size={10} className={m.botStatus === "JOINING" || m.botStatus === "TRANSCRIBING" ? "animate-spin" : ""} />
                    {botConfig.label}
                  </span>
                )}
              </div>
            </PanelSection>

            <PanelSection label="Cliente" delay={20}>
              <LinkClientSection meetingId={m.id} disabled={isPending} />
            </PanelSection>

            <PanelSection label="Acciones" delay={40}>
              <div className="flex flex-wrap gap-2">
                {botConfig?.canStop && (
                  <button
                    type="button"
                    disabled={isPending || stoppingId === m.id}
                    onClick={() => handleStop(m.id)}
                    title="Sacar al bot de la reunión ahora"
                    className={`${PILL_BUTTON} border-danger/30 text-danger hover:border-danger hover:bg-danger/10`}
                  >
                    <PhoneOff size={11} /> {stoppingId === m.id ? "Deteniendo…" : "Detener bot"}
                  </button>
                )}
                {(m.transcript || m.audioTranscript) && !pdfAttachment && (
                  <button
                    type="button"
                    disabled={isPending || actionPendingId === m.id}
                    onClick={() => handleGenerateSummary(m.id)}
                    title="Generar un resumen ejecutivo en PDF a partir de la transcripción"
                    className={`${PILL_BUTTON} border-accent-dim/40 bg-accent-dim/10 text-accent hover:bg-accent-dim/20`}
                  >
                    <FileDown size={11} /> {actionPendingId === m.id ? "Generando…" : "Generar resumen (PDF)"}
                  </button>
                )}
                {pdfAttachment && (
                  <button
                    type="button"
                    onClick={() => setViewingPdf({ url: pdfAttachment.url, title: `Resumen — ${m.title}` })}
                    title="Ver el resumen en PDF"
                    className={`${PILL_BUTTON} border-accent-dim/40 bg-accent-dim/10 text-accent hover:bg-accent-dim/20`}
                  >
                    <FileDown size={11} /> Ver PDF
                  </button>
                )}
                {m.meetingUrl ? (
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(m.meetingUrl!)}
                    title="Copiar link de la reunión"
                    className={`${PILL_BUTTON} border-border text-ink-muted hover:border-accent-dim hover:text-accent`}
                  >
                    <Copy size={11} /> Link
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-ink-faint">
                    <Video size={11} /> Sin link
                  </span>
                )}
              </div>
              {stopError?.id === m.id && <p className="text-xs text-danger">{stopError.message}</p>}
              {actionError?.id === m.id && <p className="text-xs text-danger">{actionError.message}</p>}
            </PanelSection>

            {!hasMeetingEnded(m) && (
              <PanelSection label="Cuándo / link / bot" delay={80}>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === m.id ? null : m.id)}
                    title="Editar fecha, duración o si el bot se une"
                    className={`${PILL_BUTTON} ${
                      editingId === m.id
                        ? "border-accent-dim bg-accent-dim/10 text-accent"
                        : "border-border text-ink-muted hover:border-accent-dim hover:text-accent"
                    }`}
                  >
                    <Pencil size={11} /> Editar
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleCancelMeeting(m.id)}
                    title={cancelingId === m.id ? "¿Seguro? Tocá de nuevo" : "Cancelar reunión"}
                    className={`${PILL_BUTTON} ${
                      cancelingId === m.id
                        ? "border-danger bg-danger/10 text-danger"
                        : "border-border text-ink-muted hover:border-danger hover:text-danger"
                    }`}
                  >
                    <Ban size={11} /> {cancelingId === m.id ? "¿Seguro?" : "Cancelar"}
                  </button>
                </div>

                {editingId === m.id && (
                  <form
                    onSubmit={(e) => handleEditSubmit(m.id, e)}
                    className="animate-fade-up space-y-2 rounded-lg border border-border bg-surface-2/60 p-3"
                  >
                    <input type="hidden" name="scheduledAt" defaultValue={m.scheduledAt} />
                    <input type="hidden" name="title" value={m.title} />
                    <div className="flex flex-wrap gap-2">
                      <Input
                        type="datetime-local"
                        required
                        defaultValue={utcIsoToLocalInputValue(m.scheduledAt)}
                        onChange={scheduledAtToUtcHidden}
                        className="text-sm"
                      />
                      <Input
                        type="number"
                        name="durationMinutes"
                        min={1}
                        defaultValue={m.durationMinutes}
                        className="w-24 text-sm"
                      />
                    </div>
                    <Input
                      type="url"
                      name="meetingUrl"
                      placeholder="Link de la reunión"
                      defaultValue={m.meetingUrl ?? ""}
                      className="text-sm"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                      <input type="checkbox" name="botEnabled" className="h-3.5 w-3.5" defaultChecked={m.botEnabled} />
                      Que el bot se una a esta reunión
                    </label>
                    {editError?.id === m.id && <p className="text-xs text-danger">{editError.message}</p>}
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={editPending}>
                        {editPending ? "Guardando…" : "Guardar cambios"}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                        Cancelar edición
                      </Button>
                    </div>
                  </form>
                )}
              </PanelSection>
            )}

            {m.botJoinedAt && (
              <PanelSection label="Grabación" delay={120}>
                <p className="font-mono text-xs text-ink-muted">
                  {new Date(m.botJoinedAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
                  {" → "}
                  {m.botLeftAt
                    ? new Date(m.botLeftAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
                    : "ahora"}
                  {m.botLeftAt &&
                    ` (${Math.round((new Date(m.botLeftAt).getTime() - new Date(m.botJoinedAt).getTime()) / 60_000)} min)`}
                </p>
              </PanelSection>
            )}

            {m.notes && (
              <PanelSection label="Notas" delay={160}>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{m.notes}</p>
              </PanelSection>
            )}

            <PanelSection label="Adjuntos" delay={200}>
              <MeetingAttachments meetingId={m.id} attachments={m.attachments} editable disabled={isPending} />
            </PanelSection>

            <button
              type="button"
              disabled={isPending}
              onClick={() => handleDelete(m.id)}
              title={confirmDeleteId === m.id ? "¿Seguro? Tocá de nuevo" : "Borrar reunión"}
              className={`flex cursor-pointer items-center gap-1.5 border-t border-border pt-3 text-xs transition-colors disabled:cursor-not-allowed ${
                confirmDeleteId === m.id ? "text-danger" : "text-ink-faint hover:text-danger"
              }`}
            >
              <Trash2 size={13} /> {confirmDeleteId === m.id ? "¿Seguro? Tocá de nuevo" : "Borrar reunión"}
            </button>
          </SidePanel>
        );
      })()}

      {viewingPdf && (
        <PdfViewerModal url={viewingPdf.url} title={viewingPdf.title} onClose={() => setViewingPdf(null)} />
      )}
    </div>
  );
}
