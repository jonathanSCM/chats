"use client";

import { useActionState } from "react";
import { grantExtraConversationsAction } from "@/server/actions/admin";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function GrantExtraForm({ orgId }: { orgId: string }) {
  const action = grantExtraConversationsAction.bind(null, orgId);
  const [state, formAction, isPending] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="flex items-end gap-3">
      <div className="w-32 space-y-1.5">
        <label className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Cantidad
        </label>
        <Input name="quantity" type="number" min="1" placeholder="200" required />
      </div>
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Otorgando…" : "Otorgar extra"}
      </Button>
      {state.message && <p className="text-xs text-accent">{state.message}</p>}
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
