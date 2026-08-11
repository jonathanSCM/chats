"use client";

import { useActionState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { createBotAction } from "@/server/actions/whatsapp-connection";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function CreateBotForm() {
  const [state, formAction, isPending] = useActionState(createBotAction, { error: null });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.message && !isPending) formRef.current?.reset();
  }, [state.message, isPending]);

  return (
    <form ref={formRef} action={formAction} className="flex items-end gap-3">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="name">Agregar cuenta de WhatsApp</Label>
        <Input id="name" name="name" placeholder="Ej. Ventas México, Chat 2…" required />
      </div>
      <Button type="submit" variant="secondary" disabled={isPending}>
        <Plus size={16} /> {isPending ? "Agregando…" : "Agregar"}
      </Button>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
