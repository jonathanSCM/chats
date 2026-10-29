"use client";

import { useActionState, useState, useTransition } from "react";
import { removeOpenAiKeyAction, saveOpenAiKeyAction } from "@/server/actions/ai-key";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function OpenAiKeyForm({ last4, alertMessage }: { last4: string | null; alertMessage: string | null }) {
  const [state, formAction, isPending] = useActionState(saveOpenAiKeyAction, { error: null });
  const [removing, startRemoving] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {alertMessage && (
        <p className="rounded-control border border-danger/40 bg-danger-dim px-3 py-2 text-sm text-danger">
          {alertMessage} Mientras tanto la IA de tu organización está detenida (no se usa la clave de la plataforma).
        </p>
      )}

      <p className="text-sm text-ink-muted">
        {last4 ? (
          <>
            Usando tu propia clave de OpenAI: <span className="font-code">sk-…{last4}</span>
          </>
        ) : (
          "Usando la clave de la plataforma. Si guardas la tuya, el gasto de IA va a tu cuenta de OpenAI."
        )}
      </p>

      <form action={formAction} className="space-y-3" key={last4 ?? "sin-clave"}>
        <div className="space-y-1.5">
          <Label htmlFor="openaiKey">{last4 ? "Reemplazar la clave" : "Tu clave de OpenAI"}</Label>
          <Input
            id="openaiKey"
            name="openaiKey"
            type="password"
            autoComplete="off"
            placeholder="sk-proj-…"
            className="font-code"
          />
          <p className="text-xs text-ink-faint">
            La probamos antes de guardarla y la guardamos cifrada: nadie puede volver a verla, solo los últimos 4
            caracteres.
          </p>
        </div>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {state.message && !isPending && <p className="text-sm text-accent">{state.message}</p>}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Comprobando…" : "Guardar clave"}
          </Button>
          {last4 && (
            <Button
              type="button"
              variant="secondary"
              disabled={removing}
              onClick={() =>
                startRemoving(async () => {
                  setRemoveError(null);
                  const r = await removeOpenAiKeyAction();
                  if (r.error) setRemoveError(r.error);
                })
              }
            >
              Quitar mi clave
            </Button>
          )}
        </div>
        {removeError && <p className="text-sm text-danger">{removeError}</p>}
      </form>
    </div>
  );
}
