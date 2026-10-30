"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PlanEditor, type EditablePlan } from "./plan-editor";

/** Botón "Crear plan": abre una ventana con el formulario vacío y se cierra al crear. */
export function CreatePlanButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={15} className="mr-1.5" /> Crear plan
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Crear un plan"
        description="Por ejemplo: GLA, S/ 249, hasta 5 usuarios y 8.000 créditos de IA al mes."
        className="max-w-xl"
      >
        <PlanEditor onSaved={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

/** Botón "Editar plan": ventana con los detalles del plan (precio, qué incluye, clientes) y los campos editables. */
export function EditPlanButton({
  plan,
  includes,
  clients,
}: {
  plan: EditablePlan;
  includes: string[];
  clients: { id: string; name: string; suspended: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil size={14} className="mr-1.5" /> Editar plan
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Plan ${plan.name}`}
        description="Los cambios se aplican a todos los clientes que tienen este plan."
        className="max-w-xl"
      >
        <div className="max-h-[75vh] space-y-5 overflow-y-auto pr-1">
          <div className="rounded-lg border border-border bg-surface-2/40 p-3 text-sm">
            <p className="mb-2 text-xs font-medium text-ink-faint">Detalles actuales</p>
            <ul className="space-y-1 text-ink-muted">
              {includes.map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-faint">
              {clients.length === 0 ? (
                "Ningún cliente tiene este plan todavía."
              ) : (
                <>
                  {clients.length} cliente{clients.length === 1 ? "" : "s"}:{" "}
                  {clients.map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && ", "}
                      <Link href={`/admin/organizations/${c.id}`} className="text-accent hover:underline">
                        {c.name}
                      </Link>
                      {c.suspended ? " (suspendido)" : ""}
                    </span>
                  ))}
                </>
              )}
            </p>
          </div>
          <PlanEditor plan={plan} />
        </div>
      </Dialog>
    </>
  );
}
