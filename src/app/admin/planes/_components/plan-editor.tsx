"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createPlanAction, deletePlanAction, updatePlanAction } from "@/server/actions/admin-plans";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { PlanValues } from "@/lib/plans";

export interface EditablePlan {
  id: string;
  name: string;
  priceSoles: number | null;
  values: PlanValues;
  orgCount: number;
}

/** Formulario de un plan: sirve para crear uno nuevo (sin `plan`) o editar uno existente. */
export function PlanEditor({ plan, onSaved }: { plan?: EditablePlan; onSaved?: () => void }) {
  const action = plan ? updatePlanAction.bind(null, plan.id) : createPlanAction;
  const [state, formAction, isPending] = useActionState(action, { error: null });
  const formRef = useRef<HTMLFormElement>(null);
  const [subOrgs, setSubOrgs] = useState(plan?.values.canHaveSubOrgs ?? false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const v = plan?.values;
  // Avisa a quien lo abrió (por ejemplo para cerrar la ventana) cuando el plan se guardó bien.
  useEffect(() => {
    if (state.message && !state.error) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const orgCount = plan?.orgCount ?? 0;
  // Crear un plan nuevo vacía el formulario; editar uno conserva lo escrito.
  const [createdKey, setCreatedKey] = useState(0);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  if (!plan && state.message && state.message !== lastMessage && !state.error) {
    setLastMessage(state.message);
    setCreatedKey((k) => k + 1);
    setSubOrgs(false);
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4"
      key={plan ? `${plan.id}-${JSON.stringify(plan.values)}-${plan.name}-${plan.priceSoles}` : `new-${createdKey}`}
      onSubmit={() => setConfirming(false)}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`name-${plan?.id ?? "new"}`}>Nombre del plan</Label>
          <Input id={`name-${plan?.id ?? "new"}`} name="name" defaultValue={plan?.name ?? ""} placeholder="Ej. GLA" maxLength={60} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`price-${plan?.id ?? "new"}`}>Precio mensual (S/)</Label>
          <Input
            id={`price-${plan?.id ?? "new"}`}
            name="priceSoles"
            type="number"
            min={0}
            step="0.01"
            defaultValue={plan?.priceSoles ?? ""}
            placeholder="Sin precio"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`admins-${plan?.id ?? "new"}`}>Máx. administradores</Label>
          <Input id={`admins-${plan?.id ?? "new"}`} name="maxAdmins" type="number" min={0} defaultValue={v?.maxAdmins ?? ""} placeholder="Sin límite" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`sellers-${plan?.id ?? "new"}`}>Máx. vendedores</Label>
          <Input id={`sellers-${plan?.id ?? "new"}`} name="maxSellers" type="number" min={0} defaultValue={v?.maxSellers ?? ""} placeholder="Sin límite" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`credits-${plan?.id ?? "new"}`}>Créditos de IA por mes</Label>
          <Input
            id={`credits-${plan?.id ?? "new"}`}
            name="aiCreditsMonthly"
            type="number"
            min={0}
            defaultValue={v?.aiCreditsMonthly ?? ""}
            placeholder="Sin bolsa"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="canHaveSubOrgs" defaultChecked={v?.canHaveSubOrgs ?? false} onChange={(e) => setSubOrgs(e.target.checked)} className="h-4 w-4" />
          Puede tener suborganizaciones
        </label>
        {subOrgs && (
          <div className="max-w-xs space-y-1.5 pl-6">
            <Label htmlFor={`sub-${plan?.id ?? "new"}`}>Máx. suborganizaciones</Label>
            <Input id={`sub-${plan?.id ?? "new"}`} name="maxSubOrgs" type="number" min={0} defaultValue={v?.maxSubOrgs ?? ""} placeholder="Sin límite" />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" name="canCustomizeBrand" defaultChecked={v?.canCustomizeBrand ?? false} className="h-4 w-4" />
          Puede cambiar su marca (logo, nombre, color)
        </label>
      </div>
      <p className="text-xs text-ink-faint">Dejar un límite vacío = sin tope. Sin créditos por mes = la organización no usa bolsa de créditos de IA.</p>

      {confirming && (
        <div className="rounded-md border border-warning/40 bg-warning-dim px-3 py-2 text-sm text-ink">
          Este plan lo tienen <b>{orgCount}</b> organización{orgCount === 1 ? "" : "es"}. El cambio se aplica a todas y a cada dueño le sale un
          aviso con lo que cambió en su organización.
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={() => formRef.current?.requestSubmit()}>
              Sí, aplicar a todas
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!confirming && (
          <Button
            type={plan && orgCount > 0 ? "button" : "submit"}
            size="sm"
            disabled={isPending}
            onClick={plan && orgCount > 0 ? () => setConfirming(true) : undefined}
          >
            {isPending ? "Guardando…" : plan ? "Guardar plan" : "Crear plan"}
          </Button>
        )}
        {plan && orgCount === 0 && (
          <button
            type="button"
            disabled={deleting}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 3000);
                return;
              }
              setConfirmDelete(false);
              setDeleteError(null);
              startDelete(async () => {
                const r = await deletePlanAction(plan.id);
                if (r.error) setDeleteError(r.error);
              });
            }}
            className="cursor-pointer text-sm text-danger hover:underline disabled:cursor-not-allowed"
          >
            {confirmDelete ? "¿Seguro? Toca de nuevo" : "Borrar plan"}
          </button>
        )}
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {deleteError && <p className="text-sm text-danger">{deleteError}</p>}
        {!state.error && state.message && <p className="text-sm text-success">{state.message}</p>}
      </div>
    </form>
  );
}
