"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { X, FileText, Loader2 } from "lucide-react";
import { sendTemplateMessageAction } from "@/server/actions/inbox";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

interface TemplateComponent {
  type: string;
  format?: string;
  text?: string;
}

interface Template {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: TemplateComponent[];
}

// Cuenta cuántas variables {{1}}, {{2}}... tiene el componente BODY de la
// plantilla — es lo único que este panel deja rellenar (encabezado y
// botones se mandan tal cual están aprobados).
function bodyText(template: Template): string {
  return template.components.find((c) => c.type === "BODY")?.text ?? "";
}

function variableCount(text: string): number {
  const matches = text.match(/\{\{\d+\}\}/g);
  if (!matches) return 0;
  return new Set(matches).size;
}

function renderPreview(text: string, values: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n) => values[Number(n) - 1] || `{{${n}}}`);
}

export function TemplatePickerModal({
  botId,
  conversationId,
  onClose,
  onSent,
}: {
  botId: string;
  conversationId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Template | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    fetch(`/api/whatsapp/templates?botId=${botId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setLoadError(data.error);
        else setTemplates(data.templates);
      })
      .catch(() => setLoadError("No se pudieron cargar las plantillas."));
  }, [botId]);

  function selectTemplate(t: Template) {
    setSelected(t);
    setValues(new Array(variableCount(bodyText(t))).fill(""));
    setSendError(null);
  }

  function send() {
    if (!selected) return;
    const rendered = renderPreview(bodyText(selected), values);
    startTransition(async () => {
      const result = await sendTemplateMessageAction(conversationId, {
        templateName: selected.name,
        languageCode: selected.language,
        bodyParams: values,
        renderedContent: rendered,
      });
      if (result.error) setSendError(result.error);
      else onSent();
    });
  }

  return createPortal(
    <div data-portal className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-display text-sm font-semibold text-ink">
            {selected ? "Completar plantilla" : "Elegir plantilla"}
          </p>
          <button type="button" onClick={onClose} className="cursor-pointer text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!selected ? (
            <>
              {loadError && <p className="text-sm text-danger">{loadError}</p>}
              {!loadError && templates === null && (
                <p className="flex items-center gap-2 text-sm text-ink-muted">
                  <Loader2 size={14} className="animate-spin" /> Cargando plantillas…
                </p>
              )}
              {templates?.length === 0 && (
                <p className="text-sm text-ink-muted">
                  No hay plantillas aprobadas todavía. Créalas en el Administrador comercial de
                  Meta — aparecen acá apenas Meta las apruebe.
                </p>
              )}
              <div className="space-y-2">
                {templates?.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectTemplate(t)}
                    className="flex w-full items-start gap-2.5 rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <FileText size={15} className="mt-0.5 shrink-0 text-ink-faint" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{t.name}</p>
                      <p className="text-xs text-ink-faint">
                        {t.category} · {t.language}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{bodyText(t)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <form
              id="template-vars-form"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-xs text-ink-faint hover:text-ink"
              >
                ← Elegir otra
              </button>

              {values.map((v, i) => (
                <div key={i} className="space-y-1.5">
                  <Label>Variable {i + 1}</Label>
                  <Input
                    value={v}
                    onChange={(e) => {
                      const next = [...values];
                      next[i] = e.target.value;
                      setValues(next);
                    }}
                  />
                </div>
              ))}

              <div className="rounded-md bg-surface-2 p-3">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                  Vista previa
                </p>
                <p className="whitespace-pre-wrap text-sm text-ink">
                  {renderPreview(bodyText(selected), values)}
                </p>
              </div>

              {sendError && <p className="text-sm text-danger">{sendError}</p>}
            </form>
          )}
        </div>

        {selected && (
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="template-vars-form"
              disabled={isPending || values.some((v) => !v.trim())}
            >
              {isPending ? "Enviando…" : "Enviar plantilla"}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
