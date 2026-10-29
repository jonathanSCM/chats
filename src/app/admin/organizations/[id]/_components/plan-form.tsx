"use client";

import { useActionState } from "react";
import { updateOrgPlanAction } from "@/server/actions/admin-plan";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatSeatUsage } from "@/lib/org-limits";

interface Plan {
  canHaveSubOrgs: boolean;
  maxSubOrgs: number | null;
  maxAdmins: number | null;
  maxSellers: number | null;
  canCustomizeBrand: boolean;
  aiOwnKeyEnabled: boolean;
}

export function PlanForm({
  orgId,
  plan,
  usage,
}: {
  orgId: string;
  plan: Plan;
  usage: { admins: number; sellers: number; subOrgs: number };
}) {
  const [state, formAction, isPending] = useActionState(updateOrgPlanAction.bind(null, orgId), { error: null });

  return (
    <form action={formAction} className="space-y-5" key={JSON.stringify(plan)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="maxAdmins">Máximo de administradores</Label>
          <Input
            id="maxAdmins"
            name="maxAdmins"
            type="number"
            min={0}
            defaultValue={plan.maxAdmins ?? ""}
            placeholder="Sin límite"
          />
          <p className="text-xs text-ink-faint">En uso: {formatSeatUsage(usage.admins, plan.maxAdmins)}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxSellers">Máximo de vendedores</Label>
          <Input
            id="maxSellers"
            name="maxSellers"
            type="number"
            min={0}
            defaultValue={plan.maxSellers ?? ""}
            placeholder="Sin límite"
          />
          <p className="text-xs text-ink-faint">En uso: {formatSeatUsage(usage.sellers, plan.maxSellers)}</p>
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="canHaveSubOrgs"
            defaultChecked={plan.canHaveSubOrgs}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <b>Puede tener suborganizaciones</b>
            <span className="block text-xs text-ink-faint">
              Podrá crear organizaciones hijas y elegir qué vendedores usa cada una. Hoy tiene {usage.subOrgs}.
            </span>
          </span>
        </label>
        <div className="max-w-xs space-y-1.5 pl-6">
          <Label htmlFor="maxSubOrgs">Máximo de suborganizaciones</Label>
          <Input
            id="maxSubOrgs"
            name="maxSubOrgs"
            type="number"
            min={0}
            defaultValue={plan.maxSubOrgs ?? ""}
            placeholder="Sin límite"
          />
        </div>

        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="canCustomizeBrand"
            defaultChecked={plan.canCustomizeBrand}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <b>Puede cambiar su marca</b>
            <span className="block text-xs text-ink-faint">
              Logo, nombre, color y nombre del asistente. Dominio propio: todavía no disponible.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="aiOwnKeyEnabled"
            defaultChecked={plan.aiOwnKeyEnabled}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <b>Usa su propia clave de OpenAI</b>
            <span className="block text-xs text-ink-faint">
              El dueño verá en Integraciones dónde guardarla. Sin esto, usa la clave de la plataforma.
            </span>
          </span>
        </label>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.message && !isPending && <p className="text-sm text-accent">{state.message}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar plan"}
      </Button>
      <p className="text-xs text-ink-faint">
        Dejar un límite vacío = sin tope. Bajar un límite por debajo del uso actual no saca a nadie: solo impide
        agregar más.
      </p>
    </form>
  );
}
