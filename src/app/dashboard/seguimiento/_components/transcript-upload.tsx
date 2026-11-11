"use client";

import { useActionState, useState } from "react";
import { FileText, X } from "lucide-react";
import { uploadMeetingTranscriptAction } from "@/server/actions/crm";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LONG_PASTE_CHARS, joinPasted } from "@/lib/transcript-upload";
import { useT } from "@/lib/i18n/client";

/**
 * Sube la transcripción de una reunión que no se agendó en el CRM: un archivo (.txt, .md, .vtt, .srt, .pdf) o texto
 * pegado. Un texto largo pegado no llena el cuadro: se convierte en una etiqueta («Texto pegado · N caracteres») que se
 * puede ver o quitar, como en los chats de IA.
 */
export function TranscriptUpload({ opportunityId, onDone }: { opportunityId: string; onDone: () => void }) {
  const t = useT();
  const [state, formAction, isPending] = useActionState(uploadMeetingTranscriptAction, { error: null });
  const [chips, setChips] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [openChip, setOpenChip] = useState<number | null>(null);
  const [handled, setHandled] = useState<string | undefined>(undefined);

  if (state.message && state.message !== handled) {
    setHandled(state.message);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const text = event.clipboardData.getData("text");
    if (text.length <= LONG_PASTE_CHARS) return; // lo corto se pega normal en el cuadro
    event.preventDefault();
    setChips((current) => [...current, text]);
  }

  const total = joinPasted(chips, typed).length;

  return (
    <form action={formAction} className="mb-3 space-y-2 rounded-md border border-border p-2.5">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <input type="hidden" name="text" value={joinPasted(chips, typed)} />

      <p className="text-xs text-ink-muted">
        {t("Sube la transcripción de una reunión que no se agendó acá (Zoom, Teams, otra herramienta). Queda en la ficha como una reunión realizada.")}
      </p>

      <Input type="text" name="title" placeholder={t("Nombre de la reunión (opcional)")} className="py-1.5 text-xs" />
      <div className="flex items-center gap-2">
        <label className="text-xs text-ink-muted" htmlFor={`date-${opportunityId}`}>
          {t("Fecha de la reunión")}
        </label>
        <Input id={`date-${opportunityId}`} type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} className="w-40 py-1.5 text-xs" />
      </div>

      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-ink-muted hover:border-accent-dim">
        <FileText size={13} />
        <span>{fileName ?? t("Subir archivo (.txt, .md, .vtt, .srt, .pdf)")}</span>
        <input
          type="file"
          name="file"
          accept=".txt,.md,.vtt,.srt,.pdf,text/plain,application/pdf"
          className="hidden"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
      </label>

      {chips.length > 0 && (
        <ul className="space-y-1.5">
          {chips.map((text, i) => (
            <li key={i} className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-ink">
                  <FileText size={12} className="text-ink-faint" />
                  {t("Texto pegado")} · {text.length.toLocaleString("es")} {t("caracteres")}
                </span>
                <span className="flex items-center gap-2">
                  <button type="button" className="cursor-pointer text-accent hover:opacity-80" onClick={() => setOpenChip(openChip === i ? null : i)}>
                    {openChip === i ? t("Ocultar") : t("Ver")}
                  </button>
                  <button
                    type="button"
                    title={t("Quitar")}
                    className="cursor-pointer text-ink-faint hover:text-danger"
                    onClick={() => {
                      setChips((current) => current.filter((_, j) => j !== i));
                      setOpenChip(null);
                    }}
                  >
                    <X size={13} />
                  </button>
                </span>
              </div>
              {openChip === i && <p className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap text-ink-muted">{text}</p>}
            </li>
          ))}
        </ul>
      )}

      <textarea
        rows={3}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onPaste={handlePaste}
        placeholder={t("O pega acá el texto de la transcripción… (si es largo se guarda como una etiqueta)")}
        className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-ink outline-none focus:border-accent-dim"
      />

      <label className="flex items-center gap-1.5 text-xs text-ink-muted">
        <input type="checkbox" name="analyze" defaultChecked className="h-3.5 w-3.5" />
        {t("Calificar la ficha con esta reunión al subirla (gasta créditos de IA)")}
      </label>

      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {state.message && !isPending && <p className="text-xs text-accent">{state.message}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" className="text-xs" disabled={isPending || (total === 0 && !fileName)}>
          {isPending ? t("Subiendo…") : t("Subir transcripción")}
        </Button>
        {state.message && !isPending && (
          <button type="button" className="cursor-pointer text-xs text-ink-muted underline" onClick={onDone}>
            {t("Cerrar")}
          </button>
        )}
      </div>
    </form>
  );
}
