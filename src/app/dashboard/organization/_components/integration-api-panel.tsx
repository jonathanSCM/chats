"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import {
  createIntegrationKeyAction,
  deleteWebhookAction,
  revokeIntegrationKeyAction,
  rotateWebhookSecretAction,
  saveWebhookAction,
  sendTestEventAction,
  type IntegrationActionState,
} from "@/server/actions/integrations";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface IntegrationKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface IntegrationWebhookRow {
  url: string;
  events: string[];
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

const SCOPE_LABEL: Record<string, string> = {
  read: "Leer datos",
  "write:activities": "Crear y completar tareas",
};

const EVENT_LABEL: Record<string, string> = {
  "message.created": "Mensaje nuevo",
  "conversation.assigned": "Conversación asignada",
  "meeting.transcript_ready": "Transcripción de reunión lista",
  "meeting.summary_ready": "Resumen de reunión listo",
  "opportunity.stage_changed": "Cambio de etapa",
  "opportunity.next_action_changed": "Cambio de próxima acción",
  "activity.created": "Tarea creada",
  "activity.completed": "Tarea completada",
  "document.received": "Documento recibido",
};

const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es") : "—");

export function IntegrationApiPanel({
  keys,
  webhook,
  availableEvents,
}: {
  keys: IntegrationKeyRow[];
  webhook: IntegrationWebhookRow | null;
  availableEvents: string[];
}) {
  return (
    <div className="space-y-8">
      <KeysSection keys={keys} />
      <WebhookSection webhook={webhook} availableEvents={availableEvents} />
    </div>
  );
}

function SecretOnce({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-accent-dim/50 bg-accent/10 px-3 py-2">
      <p className="flex-1 break-all font-mono text-xs text-ink">{secret}</p>
      <button
        type="button"
        className="text-ink-muted hover:text-ink"
        aria-label="Copiar"
        onClick={() => {
          void navigator.clipboard.writeText(secret).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function KeysSection({ keys }: { keys: IntegrationKeyRow[] }) {
  const [state, formAction, isPending] = useActionState<IntegrationActionState, FormData>(
    createIntegrationKeyAction,
    { error: null },
  );
  const [revoking, startRevoke] = useTransition();
  const [revokeError, setRevokeError] = useState<string | null>(null);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-ink">Claves de API</h3>
        <p className="text-xs text-ink-faint">
          Para que otro sistema (por ejemplo el Jefe de Operaciones) lea datos de esta organización. La clave se
          muestra una sola vez al crearla.
        </p>
      </div>

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="key-name">Nombre</Label>
          <Input id="key-name" name="name" placeholder="Jefe de Operaciones" required />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-xs text-ink-muted">Permisos</legend>
          <div className="flex gap-4 text-xs text-ink">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="scopes" value="read" defaultChecked /> {SCOPE_LABEL.read}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="scopes" value="write:activities" defaultChecked />{" "}
              {SCOPE_LABEL["write:activities"]}
            </label>
          </div>
        </fieldset>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creando…" : "Crear clave"}
        </Button>
      </form>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.secret && (
        <div className="space-y-1">
          <p className="text-xs text-ink-muted">{state.message}</p>
          <SecretOnce secret={state.secret} />
        </div>
      )}
      {revokeError && <p className="text-sm text-danger">{revokeError}</p>}

      {keys.length === 0 ? (
        <p className="text-xs text-ink-faint">Todavía no hay claves.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">
                  {k.name} <span className="font-mono text-ink-faint">{k.prefix}…</span>
                </p>
                <p className="text-ink-muted">
                  {k.scopes.map((s) => SCOPE_LABEL[s] ?? s).join(" · ")} · último uso {dateTime(k.lastUsedAt)}
                </p>
              </div>
              {k.revokedAt ? (
                <span className="text-ink-faint">Revocada</span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={revoking}
                  onClick={() => {
                    if (!window.confirm(`¿Revocar la clave "${k.name}"? Deja de funcionar al instante.`)) return;
                    setRevokeError(null);
                    startRevoke(async () => {
                      const r = await revokeIntegrationKeyAction(k.id);
                      if (r.error) setRevokeError(r.error);
                    });
                  }}
                >
                  Revocar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WebhookSection({
  webhook,
  availableEvents,
}: {
  webhook: IntegrationWebhookRow | null;
  availableEvents: string[];
}) {
  const [state, formAction, isPending] = useActionState<IntegrationActionState, FormData>(saveWebhookAction, {
    error: null,
  });
  const [busy, startBusy] = useTransition();
  const [result, setResult] = useState<IntegrationActionState | null>(null);

  const run = (fn: () => Promise<IntegrationActionState>) => {
    setResult(null);
    startBusy(async () => setResult(await fn()));
  };
  const shown = result ?? state;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-ink">Webhook de eventos</h3>
        <p className="text-xs text-ink-faint">
          El CRM avisa a esta dirección cuando pasa algo (mensaje nuevo, transcripción lista…). Cada aviso va firmado.
        </p>
      </div>

      <form action={formAction} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="wh-url">URL de destino</Label>
          <Input
            id="wh-url"
            name="url"
            type="url"
            defaultValue={webhook?.url ?? ""}
            placeholder="https://jefe.tu-dominio.com/webhooks/crm"
            required
          />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-xs text-ink-muted">Eventos (vacío = todos)</legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {availableEvents.map((e) => (
              <label key={e} className="flex items-center gap-1.5 text-xs text-ink">
                <input type="checkbox" name="events" value={e} defaultChecked={webhook?.events.includes(e)} />
                {EVENT_LABEL[e] ?? e}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-1.5 text-xs text-ink">
          <input type="checkbox" name="enabled" defaultChecked={webhook?.enabled ?? true} /> Activo
        </label>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Guardando…" : webhook ? "Guardar cambios" : "Crear webhook"}
        </Button>
      </form>

      {shown.error && <p className="text-sm text-danger">{shown.error}</p>}
      {!shown.error && shown.message && <p className="text-xs text-ink-muted">{shown.message}</p>}
      {shown.secret && <SecretOnce secret={shown.secret} />}

      {webhook && (
        <div className="space-y-2 rounded-md border border-border px-3 py-2 text-xs">
          <p className="text-ink-muted">
            Última entrega correcta: {dateTime(webhook.lastSuccessAt)} · Último fallo: {dateTime(webhook.lastFailureAt)}
          </p>
          {webhook.lastError && <p className="text-danger">Último error: {webhook.lastError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => run(sendTestEventAction)}>
              Enviar evento de prueba
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm("¿Generar un secreto nuevo? El anterior deja de valer.")) run(rotateWebhookSecretAction);
              }}
            >
              Rotar secreto
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm("¿Eliminar el webhook?")) run(deleteWebhookAction);
              }}
            >
              Eliminar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
