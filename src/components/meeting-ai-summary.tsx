"use client";

import { useState, useTransition } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { regenerateMeetingSummaryAction } from "@/server/actions/crm";
import { meetingSummarySchema } from "@/lib/meeting-summary";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-faint">{title}</p>
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
}: {
  meetingId: string;
  data: unknown;
  text: string;
  summarizedAt: string | null;
  hasTranscript: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
              <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-faint">Próximos pasos</p>
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
              <p className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">Información comercial</p>
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
            className="flex items-center gap-1.5 rounded-full border border-accent-dim/40 bg-accent-dim/10 px-2.5 py-1 text-[11px] text-accent transition-colors hover:bg-accent-dim/20 disabled:opacity-50"
          >
            {summary ? <RefreshCw size={11} className={pending ? "animate-spin" : ""} /> : <Sparkles size={11} />}
            {pending ? "Generando…" : summary ? "Actualizar resumen" : "Generar resumen"}
          </button>
        )}
        {summarizedAt && (
          <span className="text-[11px] text-ink-faint">Generado {new Date(summarizedAt).toLocaleString("es")}</span>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
