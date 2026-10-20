"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, RefreshCw, ClipboardCheck } from "lucide-react";
import {
  regenerateMeetingSummaryAction,
  getMeetingApplyProposalsAction,
  applyMeetingSummaryAction,
  type MeetingApplyProposal,
} from "@/server/actions/crm";
import { meetingSummarySchema } from "@/lib/meeting-summary";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-0.5 text-xs text-ink-faint">{title}</p>
      <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Resumen de IA de una reunión: lo que salió de la transcripción, qué se
 * acordó y qué información comercial apareció. Se genera solo al terminar la
 * reunión; este botón lo actualiza a pedido.
 */
export function MeetingAiSummary({
  meetingId,
  data,
  text,
  summarizedAt,
  hasTranscript,
  canApply = false,
}: {
  meetingId: string;
  data: unknown;
  text: string;
  summarizedAt: string | null;
  hasTranscript: boolean;
  /** Hay una oportunidad vinculada: se puede pasar el resumen a sus campos. */
  canApply?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    proposals: MeetingApplyProposal[];
    appliedAt: string | null;
    title: string;
  } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<string | null>(null);
  const parsed = meetingSummarySchema.safeParse(data);
  const summary = parsed.success ? parsed.data : null;

  if (!hasTranscript && !summary && !text) {
    return <p className="text-xs text-ink-faint">Sin transcripción todavía: cuando la haya, el resumen se genera solo.</p>;
  }

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await regenerateMeetingSummaryAction(meetingId);
      if (result.error) setError(result.error);
    });
  }

  function openReview() {
    setError(null);
    setApplied(null);
    startTransition(async () => {
      const result = await getMeetingApplyProposalsAction(meetingId);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.proposals.length === 0) {
        setApplied("La oportunidad ya tiene cargados estos datos: no hay nada nuevo para aplicar.");
        return;
      }
      setReview({ proposals: result.proposals, appliedAt: result.appliedAt, title: result.title });
      // Lo que estaba vacío viene marcado; lo que pisa un valor existente, no.
      setChecked(new Set(result.proposals.filter((p) => p.mode !== "replace").map((p) => p.key)));
    });
  }

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applySelected() {
    setError(null);
    startTransition(async () => {
      const result = await applyMeetingSummaryAction(meetingId, [...checked]);
      if (result.error) {
        setError(result.error);
        return;
      }
      setReview(null);
      setApplied(result.message ?? "Datos aplicados.");
      router.refresh();
    });
  }

  const c = summary?.informacionComercial;
  const commercial = c
    ? ([
        ["Necesidad", c.necesidad],
        ["Dolor", c.dolor],
        ["Presupuesto", c.presupuesto],
        ["Decisor", c.decisor],
        ["Urgencia", c.urgencia],
      ] as const).filter(([, v]) => v)
    : [];

  return (
    <div className="space-y-3">
      {summary ? (
        <>
          <p className="whitespace-pre-wrap text-sm text-ink">{summary.resumen}</p>
          <List title="Puntos clave" items={summary.puntosClave} />
          <List title="Decisiones" items={summary.decisiones} />
          {summary.proximosPasos.length > 0 && (
            <div>
              <p className="mb-0.5 text-xs text-ink-faint">Próximos pasos</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink">
                {summary.proximosPasos.map((p, i) => (
                  <li key={i}>
                    {p.accion}
                    {p.responsable && <span className="text-ink-muted"> — {p.responsable}</span>}
                    {p.fecha && <span className="text-ink-muted"> ({p.fecha})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(commercial.length > 0 || (c && (c.objeciones.length > 0 || c.acuerdos.length > 0))) && (
            <div className="space-y-1.5 rounded-md border border-border bg-surface-2/40 p-2.5">
              <p className=" text-xs text-ink-faint">Información comercial</p>
              {commercial.map(([label, value]) => (
                <p key={label} className="text-xs text-ink">
                  <span className="text-ink-muted">{label}: </span>
                  {value}
                </p>
              ))}
              {c && <List title="Objeciones" items={c.objeciones} />}
              {c && <List title="Acuerdos" items={c.acuerdos} />}
            </div>
          )}
        </>
      ) : text ? (
        <p className="whitespace-pre-wrap text-xs text-ink">{text}</p>
      ) : (
        <p className="text-xs text-ink-muted">
          Hay transcripción pero el resumen todavía no se generó (se arma solo unos minutos después de terminar la reunión).
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {hasTranscript && (
          <button
            type="button"
            disabled={pending}
            onClick={run}
            className="flex items-center gap-1.5 rounded-full border border-accent-dim/40 bg-accent-dim/10 px-2.5 py-1 text-xs text-accent transition-colors hover:bg-accent-dim/20 disabled:opacity-50"
          >
            {summary ? <RefreshCw size={11} className={pending ? "animate-spin" : ""} /> : <Sparkles size={11} />}
            {pending ? "Generando…" : summary ? "Actualizar resumen" : "Generar resumen"}
          </button>
        )}
        {summarizedAt && (
          <span className="text-xs text-ink-faint">Generado {new Date(summarizedAt).toLocaleString("es")}</span>
        )}
      </div>
      {summary && canApply && !review && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={openReview}
            className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-accent-dim hover:text-accent disabled:opacity-50"
          >
            <ClipboardCheck size={11} /> Aplicar a la oportunidad
          </button>
          {applied && <span className="text-xs text-accent">{applied}</span>}
        </div>
      )}

      {review && (
        <div className="space-y-2 rounded-md border border-accent-dim/40 bg-accent-dim/5 p-3">
          <p className="text-xs font-medium text-ink">Revisá qué pasar a &quot;{review.title}&quot;</p>
          {review.appliedAt && (
            <p className="text-xs text-ink-faint">
              Ya se aplicó una vez el {new Date(review.appliedAt).toLocaleString("es")}.
            </p>
          )}
          <ul className="space-y-2">
            {review.proposals.map((p) => (
              <li key={p.key}>
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={checked.has(p.key)}
                    onChange={() => toggle(p.key)}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{p.label}</span>
                    <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs text-ink-faint">
                      {p.mode === "fill" ? "completa" : p.mode === "append" ? "agrega" : "reemplaza"}
                    </span>
                    {p.current && p.mode !== "append" && (
                      <span className="mt-0.5 block text-ink-faint line-through">{p.current}</span>
                    )}
                    <span className="mt-0.5 block whitespace-pre-wrap text-ink">{p.proposed}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={pending || checked.size === 0}
              onClick={applySelected}
              className="rounded-full border border-accent-dim/40 bg-accent-dim/10 px-3 py-1 text-xs text-accent transition-colors hover:bg-accent-dim/20 disabled:opacity-50"
            >
              {pending ? "Aplicando…" : `Aplicar ${checked.size} campo${checked.size === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setReview(null)}
              className="rounded-full border border-border px-3 py-1 text-xs text-ink-muted hover:text-ink"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
