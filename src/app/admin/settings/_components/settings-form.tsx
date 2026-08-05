"use client";

import { useActionState, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { updatePlatformSettingsAction } from "@/server/actions/platform-settings";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function SettingsForm({
  whatsappAppId,
  whatsappConfigId,
  whatsappVerifyToken,
  hasAppSecret,
}: {
  whatsappAppId: string;
  whatsappConfigId: string;
  whatsappVerifyToken: string;
  hasAppSecret: boolean;
}) {
  const [state, formAction, isPending] = useActionState(updatePlatformSettingsAction, {
    error: null,
  });
  const verifyTokenRef = useRef<HTMLInputElement>(null);

  function generateVerifyToken() {
    const random = crypto.getRandomValues(new Uint8Array(24));
    const token = Array.from(random, (b) => b.toString(16).padStart(2, "0")).join("");
    if (verifyTokenRef.current) verifyTokenRef.current.value = token;
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="whatsappAppId">App ID</Label>
        <Input
          id="whatsappAppId"
          name="whatsappAppId"
          defaultValue={whatsappAppId}
          placeholder="123456789012345"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="whatsappAppSecret">App Secret</Label>
        <Input
          id="whatsappAppSecret"
          name="whatsappAppSecret"
          type="password"
          placeholder={hasAppSecret ? "•••••••• (configurado — déjalo vacío para no cambiarlo)" : "App secret"}
        />
        <p className="text-xs text-ink-faint">
          Se cifra antes de guardarse. Es el mismo secret que firma el webhook — cambiarlo aquí
          también afecta la verificación de mensajes entrantes.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="whatsappConfigId">Config ID (Embedded Signup)</Label>
        <Input
          id="whatsappConfigId"
          name="whatsappConfigId"
          defaultValue={whatsappConfigId}
          placeholder="Configuración con Coexistence activado"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="whatsappVerifyToken">Verify token del webhook</Label>
        <div className="flex gap-2">
          <Input
            ref={verifyTokenRef}
            id="whatsappVerifyToken"
            name="whatsappVerifyToken"
            defaultValue={whatsappVerifyToken}
            placeholder="Cualquier string — Meta lo pide al configurar el webhook"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={generateVerifyToken}
            className="shrink-0 px-3"
            title="Generar uno aleatorio"
          >
            <RefreshCw size={14} />
          </Button>
        </div>
        <p className="text-xs text-ink-faint">
          Si lo cambias, actualízalo también en Meta (Configuración → WhatsApp → Configuración de
          Webhooks) o Meta dejará de poder verificar el webhook.
        </p>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.message && !isPending && <p className="text-sm text-accent">{state.message}</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
