"use client";

import { useActionState } from "react";
import { updateBotConfigAction } from "@/server/actions/bot-config";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";

export function GeneralTab({
  botId,
  config,
}: {
  botId: string;
  config: {
    companyName: string | null;
    personality: string | null;
    instructions: string | null;
    welcomeMessage: string | null;
  } | null;
}) {
  const action = updateBotConfigAction.bind(null, botId);
  const [state, formAction, isPending] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="companyName">Empresa</Label>
          <Input
            id="companyName"
            name="companyName"
            defaultValue={config?.companyName ?? ""}
            placeholder="Demo Company"
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="welcomeMessage">Mensaje de bienvenida</Label>
        <Textarea
          id="welcomeMessage"
          name="welcomeMessage"
          defaultValue={config?.welcomeMessage ?? ""}
          placeholder="¡Hola! ¿En qué te puedo ayudar hoy?"
          className="min-h-16"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="personality">Carácter y tono</Label>
        <Textarea
          id="personality"
          name="personality"
          defaultValue={config?.personality ?? ""}
          placeholder="Cercano, entusiasta, usa emojis con moderación…"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="instructions">Instrucciones de venta</Label>
        <Textarea
          id="instructions"
          name="instructions"
          defaultValue={config?.instructions ?? ""}
          placeholder="Guía al cliente hacia el catálogo, resuelve dudas y cierra la venta…"
          className="min-h-32"
        />
        <p className="text-xs text-ink-faint">
          Esto define cómo vende tu bot. Sé específico: objeciones comunes, tono de cierre, cuándo
          escalar a un humano.
        </p>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}
