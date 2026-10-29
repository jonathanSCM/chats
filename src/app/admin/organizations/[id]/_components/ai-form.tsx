"use client";

import { useActionState, useState } from "react";
import { updateOrgAiAction } from "@/server/actions/admin-ai";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type Mode = "platform" | "custom" | "own";

const OPTIONS: { value: Mode; title: string; text: string }[] = [
  {
    value: "platform",
    title: "Clave de la plataforma (predeterminada)",
    text: "Usa tu clave de OpenAI, con el tope diario de gasto de siempre.",
  },
  {
    value: "custom",
    title: "Clave personalizada, con límite mensual",
    text: "Tú le pones una clave a esta organización y un tope de gasto y/o de tokens por mes. Al llegar al tope, la IA se detiene hasta el mes siguiente o hasta que lo amplíes.",
  },
  {
    value: "own",
    title: "Clave propia de la organización",
    text: "El dueño pega su propia clave de OpenAI en Integraciones y el gasto va a su cuenta. Sin tope de tu parte.",
  },
];

export function AiForm({
  orgId,
  mode,
  customKeyLast4,
  budgetUsd,
  tokenLimit,
  usageText,
  limitReachedMessage,
}: {
  orgId: string;
  mode: Mode;
  customKeyLast4: string | null;
  budgetUsd: number | null;
  tokenLimit: number | null;
  usageText: string | null;
  limitReachedMessage: string | null;
}) {
  const [state, formAction, isPending] = useActionState(updateOrgAiAction.bind(null, orgId), { error: null });
  const [selected, setSelected] = useState<Mode>(mode);

  return (
    <form action={formAction} className="space-y-4" key={`${mode}-${customKeyLast4}-${budgetUsd}-${tokenLimit}`}>
      <fieldset className="space-y-2">
        <legend className="sr-only">Cómo usa la IA</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex items-start gap-2 rounded-control border border-border p-3 text-sm text-ink">
            <input
              type="radio"
              name="aiMode"
              value={o.value}
              checked={selected === o.value}
              onChange={() => setSelected(o.value)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <b>{o.title}</b>
              <span className="block text-xs text-ink-faint">{o.text}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {selected === "custom" && (
        <div className="space-y-4 rounded-control border border-border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="customKey">{customKeyLast4 ? "Reemplazar la clave" : "Clave de OpenAI de esta organización"}</Label>
            <Input id="customKey" name="customKey" type="password" autoComplete="off" placeholder="sk-proj-…" className="font-code" />
            <p className="text-xs text-ink-faint">
              {customKeyLast4 ? (
                <>
                  Clave guardada: <span className="font-code">sk-…{customKeyLast4}</span>. Déjalo vacío para conservarla.
                </>
              ) : (
                "Se prueba con OpenAI antes de guardarla y queda cifrada."
              )}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="aiMonthlyBudgetUsd">Límite de gasto al mes (USD)</Label>
              <Input
                id="aiMonthlyBudgetUsd"
                name="aiMonthlyBudgetUsd"
                inputMode="decimal"
                defaultValue={budgetUsd ?? ""}
                placeholder="Sin límite"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aiMonthlyTokenLimit">Límite de tokens al mes</Label>
              <Input
                id="aiMonthlyTokenLimit"
                name="aiMonthlyTokenLimit"
                inputMode="numeric"
                defaultValue={tokenLimit ?? ""}
                placeholder="Sin límite"
              />
            </div>
          </div>
          <p className="text-xs text-ink-faint">
            Vacío = sin ese tope. El mes es el calendario (UTC). El gasto es una estimación con los precios configurados.
            Cuenta a la organización y a sus suborganizaciones juntas.
          </p>
          {mode === "custom" && usageText && <p className="text-sm text-ink-muted">Este mes: {usageText}</p>}
          {mode === "custom" && limitReachedMessage && <p className="text-sm text-danger">{limitReachedMessage}</p>}
        </div>
      )}

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.message && !isPending && <p className="text-sm text-accent">{state.message}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar IA"}
      </Button>
    </form>
  );
}
