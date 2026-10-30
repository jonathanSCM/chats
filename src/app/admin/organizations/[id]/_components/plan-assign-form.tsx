"use client";

import { useActionState, useState } from "react";
import { assignOrgPlanAction } from "@/server/actions/admin-plans";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";

export interface PlanOption {
  id: string;
  name: string;
  priceLabel: string;
  summary: string;
}

/** Elegir el plan comercial de la organización. Aplicarlo copia lo que incluye el plan a la organización. */
export function PlanAssignForm({
  orgId,
  currentPlanId,
  plans,
  isCustom,
}: {
  orgId: string;
  currentPlanId: string | null;
  plans: PlanOption[];
  /** El plan está asignado pero la organización tiene valores distintos (se ajustó a mano). */
  isCustom: boolean;
}) {
  const [state, formAction, isPending] = useActionState(assignOrgPlanAction.bind(null, orgId), { error: null });
  const [selected, setSelected] = useState(currentPlanId ?? "");
  const picked = plans.find((p) => p.id === selected);
  const changed = selected !== (currentPlanId ?? "");

  return (
    <form action={formAction} className="space-y-3" key={currentPlanId ?? "none"}>
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="planId">Plan</Label>
        <Select id="planId" name="planId" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Sin plan (a medida)</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.priceLabel}
            </option>
          ))}
        </Select>
        {picked && <p className="text-xs text-ink-faint">{picked.summary}</p>}
        {isCustom && !changed && (
          <p className="text-xs text-warning">
            Esta organización tiene valores distintos a los del plan (se ajustaron a mano). Volver a aplicar el plan los restablece.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={isPending || (!changed && !isCustom)}>
          {isPending ? "Aplicando…" : changed ? "Aplicar plan" : "Volver a aplicar el plan"}
        </Button>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {!state.error && state.message && <p className="text-sm text-success">{state.message}</p>}
      </div>
      {changed && currentPlanId && selected !== "" && (
        <p className="text-xs text-ink-faint">Como ya tenía otro plan, al dueño le saldrá un aviso con lo que cambia.</p>
      )}
    </form>
  );
}
