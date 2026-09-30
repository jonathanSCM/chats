"use client";

import { useActionState } from "react";
import { updateMetaAdAccountAction } from "@/server/actions/organization";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function MetaAdAccountForm({ currentAdAccountId }: { currentAdAccountId: string | null }) {
  const [state, formAction, isPending] = useActionState(updateMetaAdAccountAction, { error: null });

  return (
    <form action={formAction} className="space-y-4">
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="metaAdAccountId">ID de la cuenta publicitaria</Label>
        <Input
          id="metaAdAccountId"
          name="metaAdAccountId"
          placeholder="act_439705266557318"
          defaultValue={currentAdAccountId ?? ""}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
        {state.message && <p className="text-xs text-accent">{state.message}</p>}
        {state.error && <p className="text-xs text-danger">{state.error}</p>}
      </div>
    </form>
  );
}
