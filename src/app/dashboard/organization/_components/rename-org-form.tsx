"use client";

import { useActionState } from "react";
import { renameOrganizationAction } from "@/server/actions/organization";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function RenameOrgForm({ currentName }: { currentName: string }) {
  const [state, formAction, isPending] = useActionState(renameOrganizationAction, {
    error: null,
  });

  return (
    <form action={formAction} className="flex items-end gap-3">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="name">Nombre de la organización</Label>
        <Input id="name" name="name" defaultValue={currentName} required />
      </div>
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
      {state.message && <p className="text-xs text-accent">{state.message}</p>}
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
