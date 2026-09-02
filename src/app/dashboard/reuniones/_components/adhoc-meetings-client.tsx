"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, X, Copy, Trash2, Clock, Video, Zap, PhoneOff, FileDown, FileSearch } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  createAdhocMeetingAction,
  deleteAdhocMeetingAction,
  joinMeetingNowAction,
  stopMeetingBotAction,
  transcribeMeetingAction,
  generateMeetingSummaryPdfAction,
} from "@/server/actions/adhoc-meetings";
import { scheduledAtToUtcHidden } from "@/lib/datetime-local";
import { BOT_STATUS_CONFIG } from "@/lib/meeting-bot-status";
import { MeetingAttachments, type MeetingAttachmentInfo } from "@/components/meeting-attachments";
import { PdfViewerModal } from "@/components/pdf-viewer-modal";

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
  notes: string;
  transcript: string;
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

export function AdhocMeetingsClient({ meetings }: { meetings: AdhocMeetingRow[] }) {
  const [adding, setAdding] = useState(false);
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
  function handleTranscribe(id: string) {
    setActionPendingId(id);
    setActionError(null);
    startTransition(async () => {
      const result = await transcribeMeetingAction(id);
      setActionPendingId(null);
      if (result.error) setActionError({ id, message: result.error });
    });
  }
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
              <input type="checkbox" name="withGoogleMeet" className="h-3.5 w-3.5" />
              Crear con Google Meet (genera el link automáticamente)
            </label>
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
            const pdfAttachment = m.attachments.find((a) => a.mimeType === "application/pdf");
            return (
            <Card key={m.id} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-ink">{m.title}</p>
                <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                  {STATUS_LABEL[m.status] ?? m.status}
                </span>
                {botConfig && BotIcon && (
                  <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] ${botConfig.className}`}>
                    <BotIcon size={10} className={m.botStatus === "JOINING" || m.botStatus === "TRANSCRIBING" ? "animate-spin" : ""} />
                    {botConfig.label}
                  </span>
                )}
                {botConfig?.canStop && (
                  <button
                    type="button"
                    disabled={isPending || stoppingId === m.id}
                    onClick={() => handleStop(m.id)}
                    title="Sacar al bot de la reunión ahora"
                    className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-ink-muted hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PhoneOff size={11} /> {stoppingId === m.id ? "Deteniendo…" : "Detener bot"}
                  </button>
                )}
                {m.botStatus === "RECORDED" && (
                  <button
                    type="button"
                    disabled={isPending || actionPendingId === m.id}
                    onClick={() => handleTranscribe(m.id)}
                    title="Transcribir el audio con Whisper (sin nombres de quién habló)"
                    className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-ink-muted hover:border-accent-dim hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FileSearch size={11} /> {actionPendingId === m.id ? "Pidiendo…" : "Transcribir"}
                  </button>
                )}
                {m.transcript && !pdfAttachment && (
                  <button
                    type="button"
                    disabled={isPending || actionPendingId === m.id}
                    onClick={() => handleGenerateSummary(m.id)}
                    title="Generar un resumen ejecutivo en PDF a partir de la transcripción"
                    className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-ink-muted hover:border-accent-dim hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FileDown size={11} /> {actionPendingId === m.id ? "Generando…" : "Generar resumen (PDF)"}
                  </button>
                )}
                {pdfAttachment && (
                  <button
                    type="button"
                    onClick={() => setViewingPdf({ url: pdfAttachment.url, title: `Resumen — ${m.title}` })}
                    title="Ver el resumen en PDF"
                    className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-ink-muted hover:border-accent-dim hover:text-accent"
                  >
                    <FileDown size={11} /> Ver PDF
                  </button>
                )}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleDelete(m.id)}
                  title={confirmDeleteId === m.id ? "¿Seguro? Tocá de nuevo" : "Borrar reunión"}
                  className={`cursor-pointer disabled:cursor-not-allowed ${
                    confirmDeleteId === m.id ? "text-danger" : "text-ink-faint hover:text-danger"
                  }`}
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {stopError?.id === m.id && <p className="text-xs text-danger">{stopError.message}</p>}
              {actionError?.id === m.id && <p className="text-xs text-danger">{actionError.message}</p>}

              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                <span className="flex items-center gap-1">
                  <Clock size={12} className="text-ink-faint" /> {timeLabel(m.scheduledAt)} ·{" "}
                  {m.durationMinutes} min
                </span>
                {m.meetingUrl && (
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(m.meetingUrl!)}
                    title="Copiar link de la reunión"
                    className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:border-accent-dim hover:text-accent"
                  >
                    <Copy size={11} /> Link
                  </button>
                )}
                {!m.meetingUrl && (
                  <span className="flex items-center gap-1 text-ink-faint">
                    <Video size={12} /> Sin link
                  </span>
                )}
              </div>

              {m.botJoinedAt && (
                <p className="font-mono text-[10px] text-ink-faint">
                  Grabó de {new Date(m.botJoinedAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}{" "}
                  a{" "}
                  {m.botLeftAt
                    ? new Date(m.botLeftAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })
                    : "ahora"}
                  {m.botLeftAt &&
                    ` (${Math.round((new Date(m.botLeftAt).getTime() - new Date(m.botJoinedAt).getTime()) / 60_000)}m)`}
                </p>
              )}

              {m.transcript && (
                <details className="text-xs text-ink-muted">
                  <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                    Transcripción
                  </summary>
                  <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{m.transcript}</p>
                </details>
              )}

              {m.notes && <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-muted">{m.notes}</p>}

              <MeetingAttachments meetingId={m.id} attachments={m.attachments} editable disabled={isPending} />
            </Card>
            );
          })}
        </div>
      )}
      {viewingPdf && (
        <PdfViewerModal url={viewingPdf.url} title={viewingPdf.title} onClose={() => setViewingPdf(null)} />
      )}
    </div>
  );
}
