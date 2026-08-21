"use client";

import { useActionState, useEffect, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { createMessageTemplateAction } from "@/server/actions/whatsapp-connection";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Template {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
}

const STATUS_TONE: Record<string, "accent" | "warning" | "danger" | "neutral"> = {
  APPROVED: "accent",
  PENDING: "warning",
  REJECTED: "danger",
  PENDING_DELETION: "danger",
};

export function TemplateManager({ botId }: { botId: string }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const action = createMessageTemplateAction.bind(null, botId);
  const [state, formAction, isPending] = useActionState(action, { error: null });

  function load() {
    fetch(`/api/whatsapp/templates?botId=${botId}&all=1`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setLoadError(data.error);
        else {
          setLoadError(null);
          setTemplates(data.templates);
        }
      })
      .catch(() => setLoadError("No se pudieron cargar las plantillas."));
  }

  useEffect(load, [botId]);

  const [handledMessage, setHandledMessage] = useState<string | undefined>(undefined);
  if (state.message && state.message !== handledMessage) {
    setHandledMessage(state.message);
    setCreating(false);
  }

  useEffect(() => {
    if (state.message) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message]);

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Plantillas de mensaje</CardTitle>
          <CardDescription>
            Para escribirle primero a un cliente fuera de la ventana de 24h. Meta las revisa
            antes de aprobarlas.
          </CardDescription>
        </div>
        <Button type="button" variant="secondary" onClick={() => setCreating((v) => !v)}>
          <Plus size={14} /> Crear plantilla
        </Button>
      </div>

      {creating && (
        <form action={formAction} className="space-y-3 rounded-md border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nombre (identificador)</Label>
              <Input id="name" name="name" placeholder="confirmacion_pedido" required />
              <p className="text-[11px] text-ink-faint">Solo minúsculas, números y guion bajo.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Categoría</Label>
              <Select id="category" name="category" defaultValue="UTILITY">
                <option value="UTILITY">Utilidad (UTILITY)</option>
                <option value="MARKETING">Marketing (MARKETING)</option>
                <option value="AUTHENTICATION">Autenticación (AUTHENTICATION)</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="languageCode">Idioma</Label>
            <Select id="languageCode" name="languageCode" defaultValue="es">
              <option value="es">Español</option>
              <option value="es_MX">Español (México)</option>
              <option value="en_US">Inglés (EE. UU.)</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bodyText">Texto del mensaje</Label>
            <Textarea
              id="bodyText"
              name="bodyText"
              rows={3}
              placeholder="Hola {{1}}, tu pedido #{{2}} ya está confirmado."
              required
            />
            <p className="text-[11px] text-ink-faint">
              Usa <code className="font-mono">{"{{1}}"}</code>, <code className="font-mono">{"{{2}}"}</code>…
              para las partes que cambian en cada envío.
            </p>
          </div>

          {state.error && <p className="text-sm text-danger">{state.error}</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? "Enviando a Meta…" : "Enviar a revisión"}
          </Button>
        </form>
      )}

      {state.message && !creating && <p className="text-sm text-accent">{state.message}</p>}

      <div className="space-y-2">
        {loadError && <p className="text-sm text-warning">{loadError}</p>}
        {!loadError && templates === null && (
          <p className="text-sm text-ink-muted">Cargando plantillas…</p>
        )}
        {templates?.length === 0 && (
          <p className="text-sm text-ink-muted">Todavía no hay plantillas creadas.</p>
        )}
        {templates?.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={14} className="shrink-0 text-ink-faint" />
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{t.name}</p>
                <p className="text-xs text-ink-faint">
                  {t.category} · {t.language}
                </p>
              </div>
            </div>
            <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}
