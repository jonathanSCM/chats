"use client";

import { useActionState, useEffect, useState } from "react";
import { updateMyNameAction } from "@/server/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NameForm({ currentName }: { currentName: string }) {
  const [state, formAction, isPending] = useActionState(updateMyNameAction, { error: null });

  // Campo controlado, no defaultValue: un <form action={...}> resetea solo
  // los inputs no controlados cuando la acción termina bien -- se guardaba
  // el nombre pero el campo volvía a mostrar el de antes (mismo bug que ya
  // se corrigió en ContactForm del panel del inbox).
  const [name, setName] = useState(currentName);
  useEffect(() => setName(currentName), [currentName]);

  return (
    <form action={formAction} className="flex items-end gap-2">
      <div className="flex-1 space-y-1">
        <Input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tu nombre"
          required
        />
        {state.error && <p className="text-xs text-danger">{state.error}</p>}
        {state.message && !state.error && <p className="text-xs text-accent">{state.message}</p>}
      </div>
      <Button type="submit" disabled={isPending} className="shrink-0">
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
