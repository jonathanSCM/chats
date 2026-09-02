"use client";

import { useActionState, useState } from "react";
import { Copy, Check } from "lucide-react";
import { createOrganizationAction } from "@/server/actions/admin";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function CreateOrgForm() {
  const [state, formAction, isPending] = useActionState(createOrganizationAction, { error: null });
  const isInviteUrl = state.message?.startsWith("http");

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="companyName">Nombre de la empresa</Label>
          <Input id="companyName" name="companyName" placeholder="Ej. Comercial Andina S.R.L." required />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="ownerEmail">Correo del dueño (opcional)</Label>
          <Input id="ownerEmail" name="ownerEmail" type="email" placeholder="dueño@empresa.com" />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creando…" : "Crear organización"}
        </Button>
      </form>
      <p className="text-xs text-ink-faint">
        Crea la organización vacía (sin bots ni datos) y un link de invitación de dueño — quien lo
        abra pone su propio nombre y contraseña, igual que cualquier invitación de equipo. Si
        pusiste el correo, además se lo mandamos por mail.
      </p>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {isInviteUrl && <CopyableLink url={state.message!} />}
    </div>
  );
}

function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-md border border-accent-dim/50 bg-accent/10 px-3 py-2">
      <p className="flex-1 truncate font-mono text-xs text-ink">{url}</p>
      <button
        type="button"
        className="shrink-0 cursor-pointer text-accent hover:brightness-125"
        onClick={() => {
          navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}
