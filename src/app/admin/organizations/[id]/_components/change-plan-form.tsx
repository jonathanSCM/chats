"use client";

import { useActionState } from "react";
import { adminChangeOrgPlanAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

interface PlanOption {
  id: string;
  name: string;
}

export function ChangePlanForm({
  orgId,
  plans,
  currentPlanId,
}: {
  orgId: string;
  plans: PlanOption[];
  currentPlanId: string;
}) {
  const action = adminChangeOrgPlanAction.bind(null, orgId);
  const [state, formAction, isPending] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="flex items-end gap-3">
      <div className="flex-1 space-y-1.5">
        <label className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Plan
        </label>
        <select
          name="planId"
          defaultValue={currentPlanId}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-dim"
        >
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Guardando…" : "Cambiar plan"}
      </Button>
      {state.message && <p className="text-xs text-accent">{state.message}</p>}
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
