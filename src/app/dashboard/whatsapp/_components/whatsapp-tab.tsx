"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleDashed, Lock, Smartphone, Clock } from "lucide-react";
import { connectWhatsAppAction } from "@/server/actions/whatsapp-connection";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClickToChat } from "./click-to-chat";
import { EmbeddedSignupButton } from "./embedded-signup-button";

export function WhatsAppTab({
  botId,
  connection,
  readOnly = false,
}: {
  botId: string;
  connection: {
    phoneNumberId: string;
    wabaId: string | null;
    verified: boolean;
    displayNumber?: string | null;
    coexistence?: boolean;
    historySyncStatus?: "NONE" | "PENDING" | "COMPLETE";
  } | null;
  readOnly?: boolean;
}) {
  const action = connectWhatsAppAction.bind(null, botId);
  const [state, formAction, isPending] = useActionState(action, { error: null });

  return (
    <div className="max-w-xl space-y-6">
      <Card className="flex items-center gap-3 py-4">
        {connection?.verified ? (
          <CheckCircle2 size={20} className="shrink-0 text-accent" />
        ) : (
          <CircleDashed size={20} className="shrink-0 text-ink-faint" />
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm text-ink">
              {connection?.verified ? "Número conectado y verificado" : "Sin número conectado"}
            </p>
            {connection?.coexistence && (
              <Badge tone="accent">
                <Smartphone size={12} /> Coexistence
              </Badge>
            )}
          </div>
          {connection && (
            <p className="font-mono text-xs text-ink-muted">phone_number_id: {connection.phoneNumberId}</p>
          )}
          {connection?.coexistence && connection.historySyncStatus === "PENDING" && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-warning">
              <Clock size={12} /> Importando historial de conversaciones previas… puede tardar
              varios minutos.
            </p>
          )}
        </div>
      </Card>

      {readOnly ? (
        <Card className="flex items-center gap-3 py-4 text-sm text-ink-muted">
          <Lock size={16} className="shrink-0 text-ink-faint" />
          Solo el dueño de la organización puede conectar o cambiar estos datos.
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="space-y-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-ink">
                Opción recomendada: usar el número que ya tienes en el celular
              </h3>
              <p className="mt-1 text-xs text-ink-muted">
                Con Coexistence, ese número sigue funcionando normal en la app de WhatsApp
                Business de tu celular — el equipo también puede responder desde aquí, y todo se
                mantiene sincronizado entre ambos.
              </p>
            </div>
            <EmbeddedSignupButton botId={botId} />
          </Card>

          <details className="group">
            <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink-muted">
              O conectar a mano con credenciales de la Cloud API (para un número dedicado, sin
              Coexistence)
            </summary>
            <form action={formAction} className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="phoneNumberId">Phone number ID</Label>
                <Input
                  id="phoneNumberId"
                  name="phoneNumberId"
                  defaultValue={connection?.phoneNumberId ?? ""}
                  placeholder="123456789012345"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wabaId">WhatsApp Business Account ID</Label>
                <Input
                  id="wabaId"
                  name="wabaId"
                  defaultValue={connection?.wabaId ?? ""}
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="accessToken">Access token</Label>
                <Input id="accessToken" name="accessToken" type="password" placeholder="EAAG…" required />
                <p className="text-xs text-ink-faint">
                  Se cifra antes de guardarse. Nunca se muestra en texto plano de nuevo.
                </p>
              </div>

              {state.error && <p className="text-sm text-danger">{state.error}</p>}

              <Button type="submit" disabled={isPending}>
                {isPending ? "Verificando…" : "Conectar y verificar"}
              </Button>
            </form>
          </details>
        </div>
      )}

      {connection?.verified && connection.displayNumber && (
        <ClickToChat displayNumber={connection.displayNumber} />
      )}
    </div>
  );
}
