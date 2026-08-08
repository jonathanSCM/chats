"use client";

import { useActionState } from "react";
import { updateAiSettingsAction } from "@/server/actions/organization";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AiSettingsForm({ currentLimit }: { currentLimit: number }) {
  const [state, formAction, isPending] = useActionState(updateAiSettingsAction, {
    error: null,
  });

  return (
    <form action={formAction} className="flex items-end gap-3">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="aiMessageLimit">Mensajes recientes que analiza el asesor IA</Label>
        <Input
          id="aiMessageLimit"
          name="aiMessageLimit"
          type="number"
          min={5}
          max={100}
          defaultValue={currentLimit}
          required
        />
        <p className="text-xs text-ink-muted">
          Cuántos mensajes de WhatsApp recientes se le mandan al asesor en cada análisis. Más
          mensajes dan más contexto, pero cuestan más por análisis.
        </p>
      </div>
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
      {state.message && <p className="text-xs text-accent">{state.message}</p>}
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
