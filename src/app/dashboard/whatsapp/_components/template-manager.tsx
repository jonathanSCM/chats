"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { FileText, Plus, Trash2, RefreshCw } from "lucide-react";
import {
  createMessageTemplateAction,
  deleteMessageTemplateAction,
} from "@/server/actions/whatsapp-connection";
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
  rejected_reason?: string;
}

const STATUS_TONE: Record<string, "accent" | "warning" | "danger" | "neutral"> = {
  APPROVED: "accent",
  PENDING: "warning",
  REJECTED: "danger",
  PENDING_DELETION: "danger",
};

const REJECTED_REASON_LABEL: Record<string, string> = {
  ABUSIVE_CONTENT: "Contenido considerado abusivo/spam por Meta.",
  INVALID_FORMAT: "El formato del mensaje no es válido (revisa variables y estructura).",
  TAG_CONTENT_MISMATCH: "La categoría elegida (MARKETING/UTILITY/AUTHENTICATION) no coincide con el contenido del mensaje.",
  INCORRECT_CATEGORY: "La categoría elegida no coincide con el contenido — Meta espera que la cambies.",
  SCAM: "Meta detectó el mensaje como posible estafa.",
  PROMOTIONAL: "Contenido demasiado promocional para la categoría elegida.",
};

export function TemplateManager({ botId }: { botId: string }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const [isLoading, setIsLoading] = useState(false);

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

  // Si Meta aprueba/rechaza una plantilla mientras la pestaña sigue
  // abierta, el estado no se refresca solo — botón manual para no tener
  // que salir y volver a entrar a la pantalla. Separado de `load()` (que
  // dispara el efecto de montaje) para no llamar setState de forma
  // síncrona dentro de un efecto.
  function refresh() {
    setIsLoading(true);
    fetch(`/api/whatsapp/templates?botId=${botId}&all=1`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setLoadError(data.error);
        else {
          setLoadError(null);
          setTemplates(data.templates);
        }
      })
      .catch(() => setLoadError("No se pudieron cargar las plantillas."))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, [botId]);

  function handleDelete(name: string) {
    if (confirmDeleteName !== name) {
      setConfirmDeleteName(name);
      setTimeout(() => setConfirmDeleteName((cur) => (cur === name ? null : cur)), 3000);
      return;
    }
    setConfirmDeleteName(null);
    setDeleteError(null);
    startDelete(async () => {
      const result = await deleteMessageTemplateAction(botId, name);
      if (result.error) setDeleteError(result.error);
      else load();
    });
  }

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
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading}
            title="Actualizar estado de las plantillas"
            className="cursor-pointer text-ink-faint hover:text-ink disabled:cursor-not-allowed"
          >
            <RefreshCw size={15} className={isLoading ? "animate-spin" : ""} />
          </button>
          <Button type="button" variant="secondary" onClick={() => setCreating((v) => !v)}>
            <Plus size={14} /> Crear plantilla
          </Button>
        </div>
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

          <div className="space-y-1.5">
            <Label htmlFor="bodyExample">Ejemplo de esos valores (si usaste variables)</Label>
            <Input id="bodyExample" name="bodyExample" placeholder="Jonathan, 20, 31 de agosto" />
            <p className="text-[11px] text-ink-faint">
              Un valor por cada <code className="font-mono">{"{{n}}"}</code>, separados por coma, en
              orden. Meta lo exige para revisar la plantilla — si tiene variables y no das
              ejemplos, la rechaza automáticamente sin revisarla.
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
        {deleteError && <p className="text-sm text-danger">{deleteError}</p>}
        {!loadError && templates === null && (
          <p className="text-sm text-ink-muted">Cargando plantillas…</p>
        )}
        {templates?.length === 0 && (
          <p className="text-sm text-ink-muted">Todavía no hay plantillas creadas.</p>
        )}
        {templates?.map((t) => (
          <div key={t.id} className="rounded-md border border-border px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText size={14} className="shrink-0 text-ink-faint" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{t.name}</p>
                  <p className="text-xs text-ink-faint">
                    {t.category} · {t.language}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status}</Badge>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => handleDelete(t.name)}
                  title="Borrar plantilla"
                  className="cursor-pointer text-ink-faint hover:text-danger disabled:opacity-40"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            {confirmDeleteName === t.name && (
              <p className="mt-1.5 text-xs text-warning">
                ¿Seguro que quieres borrarla? Toca el ícono de nuevo para confirmar.
              </p>
            )}
            {t.status === "REJECTED" && t.rejected_reason && t.rejected_reason !== "NONE" && (
              <p className="mt-1.5 text-xs text-danger">
                Motivo: {REJECTED_REASON_LABEL[t.rejected_reason] ?? t.rejected_reason}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
