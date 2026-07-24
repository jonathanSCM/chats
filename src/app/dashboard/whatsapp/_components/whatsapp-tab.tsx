"use client";

import { useActionState } from "react";
import { CheckCircle2, CircleDashed, Lock } from "lucide-react";
import { connectWhatsAppAction } from "@/server/actions/whatsapp-connection";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ClickToChat } from "./click-to-chat";


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
        <div>
          <p className="text-sm text-ink">
            {connection?.verified ? "Número conectado y verificado" : "Sin número conectado"}
          </p>
          {connection && (
            <p className="font-mono text-xs text-ink-muted">phone_number_id: {connection.phoneNumberId}</p>
          )}
        </div>
      </Card>

      {readOnly ? (
        <Card className="flex items-center gap-3 py-4 text-sm text-ink-muted">
          <Lock size={16} className="shrink-0 text-ink-faint" />
          Solo el dueño de la organización puede conectar o cambiar estos datos.
        </Card>
      ) : (
        <form action={formAction} className="space-y-4">
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
      )}

      {connection?.verified && connection.displayNumber && (
        <ClickToChat displayNumber={connection.displayNumber} />
      )}
    </div>
  );
}
