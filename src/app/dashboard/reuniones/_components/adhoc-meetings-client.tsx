"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, X, Copy, Trash2, Clock, Video, Bot } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createAdhocMeetingAction, deleteAdhocMeetingAction } from "@/server/actions/adhoc-meetings";

export interface AdhocMeetingRow {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  meetingUrl: string | null;
  status: string;
  botStatus: string | null;
  notes: string;
  aiSummary: string;
}

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Agendada",
  CONFIRMED: "Confirmada",
  DONE: "Realizada",
  CANCELED: "Cancelada",
  NO_SHOW: "No se presentó",
};

// Estado del bot de grabación (independiente del estado de la reunión) —
// null significa que no se pidió que el bot se una (sin link de Meet).
const BOT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Se va a grabar",
  JOINING: "El bot está entrando…",
  RECORDING: "Grabando…",
  TRANSCRIBING: "Transcribiendo…",
  DONE: "Transcripción lista",
  FAILED: "Falló — revisar a mano",
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

  return (
    <div className="space-y-4">
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
            <div className="flex gap-2">
              <Input type="datetime-local" name="scheduledAt" required className="text-sm" />
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
          {meetings.map((m) => (
            <Card key={m.id} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-ink">{m.title}</p>
                <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                  {STATUS_LABEL[m.status] ?? m.status}
                </span>
                {m.botStatus && (
                  <span className="flex items-center gap-1 rounded-full bg-accent-dim/20 px-2 py-0.5 font-mono text-[10px] text-accent">
                    <Bot size={10} /> {BOT_STATUS_LABEL[m.botStatus] ?? m.botStatus}
                  </span>
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

              {m.aiSummary && (
                <div className="rounded-md border border-accent-dim/30 bg-accent-dim/10 p-2.5">
                  <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent">
                    Resumen
                  </p>
                  <p className="text-xs leading-relaxed text-ink-muted">{m.aiSummary}</p>
                </div>
              )}

              {m.notes && (
                <details className="text-xs text-ink-muted">
                  <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                    Transcripción completa
                  </summary>
                  <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{m.notes}</p>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
