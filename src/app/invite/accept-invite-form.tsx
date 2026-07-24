"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "@/server/actions/team";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AcceptInviteForm({ token, fixedEmail }: { token: string; fixedEmail?: string }) {
  const [state, formAction, isPending] = useActionState(acceptInviteAction, { error: null });

  return (
    <div className="corner-brackets rounded-lg border border-border bg-surface p-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />

        <div className="space-y-1.5">
          <Label htmlFor="name">Tu nombre</Label>
          <Input id="name" name="name" required autoComplete="name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Correo</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={fixedEmail}
            readOnly={Boolean(fixedEmail)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>

        {state.error && <p className="text-sm text-danger">{state.error}</p>}

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Uniéndote…" : "Unirme al equipo"}
        </Button>
      </form>
    </div>
  );
}
