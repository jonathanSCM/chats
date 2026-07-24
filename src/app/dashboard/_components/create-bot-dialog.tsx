"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { createBotAction } from "@/server/actions/bots";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";

export function CreateBotDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createBotAction, { error: null });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={16} /> Nuevo bot
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Crear bot"
        description="Le pondremos un nombre; el resto lo configuras después."
      >
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nombre del bot</Label>
            <Input id="name" name="name" placeholder="Vendedor Principal" required autoFocus />
          </div>

          {state.error && <p className="text-sm text-danger">{state.error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creando…" : "Crear bot"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
