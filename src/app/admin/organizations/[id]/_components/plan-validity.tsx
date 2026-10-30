"use client";

import { useActionState, useState, useTransition } from "react";
import { renewOrgPlanAction, setOrgPlanEndAction } from "@/server/actions/admin-plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

const TONE = { none: "neutral", active: "accent", expiring: "warning", grace: "warning", expired: "danger" } as const;

/** Vigencia del plan de una organización: hasta cuándo está activo, renovarlo y fijar la fecha a mano. */
export function PlanValidity({
  orgId,
  state,
  stateLabel,
  startedAtLabel,
  endsAtLabel,
  endsAtInput,
  daysText,
}: {
  orgId: string;
  state: keyof typeof TONE;
  stateLabel: string;
  startedAtLabel: string | null;
  endsAtLabel: string | null;
  /** Fecha actual de vencimiento como "YYYY-MM-DD" para el selector de fecha. */
  endsAtInput: string;
  daysText: string | null;
}) {
  const [months, setMonths] = useState("1");
  const [isPending, startTransition] = useTransition();
  const [renewMessage, setRenewMessage] = useState<{ error?: string; ok?: string } | null>(null);
  const [state2, formAction, datePending] = useActionState(setOrgPlanEndAction.bind(null, orgId), { error: null });

  function renew() {
    setRenewMessage(null);
    startTransition(async () => {
      const r = await renewOrgPlanAction(orgId, Number(months));
      setRenewMessage(r.error ? { error: r.error } : { ok: r.message ?? "Plan renovado." });
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium text-ink">Vigencia del plan</h4>
        <Badge tone={TONE[state]}>{stateLabel}</Badge>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-ink-faint">Activo desde</dt>
          <dd className="font-medium text-ink">{startedAtLabel ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Activo hasta</dt>
          <dd className="font-medium text-ink">{endsAtLabel ?? "Sin fecha de vencimiento"}</dd>
          {daysText && <dd className="text-xs text-ink-faint">{daysText}</dd>}
        </div>
      </dl>
      <p className="text-xs text-ink-faint">
        Se avisa al dueño 7 días antes. Al vencer hay 5 días de gracia en los que todo sigue funcionando; después se detiene la IA y el asistente de
        reuniones (el CRM sigue funcionando). La bolsa de créditos se renueva cada mes el mismo día que empezó el plan.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="renew-months">Renovar por</Label>
          <Select id="renew-months" value={months} onChange={(e) => setMonths(e.target.value)} className="w-32">
            {[1, 2, 3, 6, 12].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "mes" : "meses"}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" size="sm" onClick={renew} disabled={isPending}>
          {isPending ? "Renovando…" : "Renovar plan"}
        </Button>
        {renewMessage?.error && <p className="text-sm text-danger">{renewMessage.error}</p>}
        {renewMessage?.ok && <p className="text-sm text-success">{renewMessage.ok} Se avisó al dueño.</p>}
      </div>

      <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-border pt-4" key={endsAtInput}>
        <div className="space-y-1.5">
          <Label htmlFor="plan-ends">O fijar la fecha de vencimiento</Label>
          <Input id="plan-ends" name="endsAt" type="date" defaultValue={endsAtInput} className="w-44" required />
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={datePending}>
          {datePending ? "Guardando…" : "Guardar fecha"}
        </Button>
        {state2.error && <p className="text-sm text-danger">{state2.error}</p>}
        {!state2.error && state2.message && <p className="text-sm text-success">{state2.message}</p>}
      </form>
    </div>
  );
}
