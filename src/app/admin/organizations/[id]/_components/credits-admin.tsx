"use client";

import { useActionState, useState, useTransition } from "react";
import { addCreditPackAction, cancelCreditPackAction, updateOrgCreditsPlanAction } from "@/server/actions/admin-credits";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { CREDIT_PACKS, PACK_VALID_DAYS, formatCredits, suggestedMonthlyCredits } from "@/lib/ai-credits";

/** Créditos por mes del plan. Vacío = la organización no usa créditos. */
export function CreditsPlanForm({ orgId, monthly, users }: { orgId: string; monthly: number | null; users: number }) {
  const [state, formAction, isPending] = useActionState(updateOrgCreditsPlanAction.bind(null, orgId), { error: null });
  const suggested = suggestedMonthlyCredits(users);

  return (
    <form action={formAction} className="space-y-3" key={String(monthly)}>
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="aiCreditsMonthly">Créditos de IA por mes</Label>
        <Input
          id="aiCreditsMonthly"
          name="aiCreditsMonthly"
          type="number"
          min={0}
          step={1}
          defaultValue={monthly ?? ""}
          placeholder="Sin créditos (sin bolsa)"
        />
        <p className="text-xs text-ink-faint">
          Bolsa compartida por todos los usuarios; se renueva cada mes y no se acumula. Referencia: {formatCredits(suggested)} créditos
          para {users} usuario{users === 1 ? "" : "s"} (1.600 por usuario). Vacío = esta organización no usa créditos.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar plan de créditos"}
        </Button>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {!state.error && state.message && <p className="text-sm text-success">{state.message}</p>}
      </div>
    </form>
  );
}

/** Recarga manual de créditos (hasta que haya pasarela de pago). */
export function AddPackForm({ orgId }: { orgId: string }) {
  const [state, formAction, isPending] = useActionState(addCreditPackAction.bind(null, orgId), { error: null });
  const [credits, setCredits] = useState("");
  // Tras una recarga exitosa el formulario se vacía.
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  if (state.message && state.message !== lastMessage && !state.error) {
    setLastMessage(state.message);
    setCredits("");
  }

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {CREDIT_PACKS.map((p) => (
          <button
            key={p.credits}
            type="button"
            onClick={() => setCredits(String(p.credits))}
            className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs text-ink-muted hover:border-accent-dim hover:text-ink"
          >
            {formatCredits(p.credits)} · S/ {p.priceSoles}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="credits">Créditos a agregar</Label>
          <Input id="credits" name="credits" type="number" min={1} step={1} value={credits} onChange={(e) => setCredits(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="days">Vigencia (días)</Label>
          <Input id="days" name="days" type="number" min={1} defaultValue={PACK_VALID_DAYS} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note">Nota (opcional)</Label>
          <Input id="note" name="note" maxLength={200} placeholder="Ej. Pago Yape 29/10" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={isPending || !credits}>
          {isPending ? "Agregando…" : "Agregar créditos"}
        </Button>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {!state.error && state.message && <p className="text-sm text-success">{state.message}</p>}
      </div>
    </form>
  );
}

/** Anula un paquete cargado por error (pide confirmar con un segundo toque). */
export function CancelPackButton({ packId }: { packId: string }) {
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm) {
            setConfirm(true);
            setTimeout(() => setConfirm(false), 3000);
            return;
          }
          setConfirm(false);
          setError(null);
          startTransition(async () => {
            const r = await cancelCreditPackAction(packId);
            if (r.error) setError(r.error);
          });
        }}
        className="cursor-pointer text-xs text-danger hover:underline disabled:cursor-not-allowed"
      >
        {confirm ? "¿Seguro? Toca de nuevo" : "Anular"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
