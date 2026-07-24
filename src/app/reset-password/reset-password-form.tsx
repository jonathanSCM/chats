"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetPasswordAction } from "@/server/actions/password-reset";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(resetPasswordAction, { error: null });

  if (state.message) {
    return (
      <div className="corner-brackets rounded-lg border border-border bg-surface p-6 text-center">
        <p className="mb-4 text-sm text-ink">{state.message}</p>
        <Link href="/login">
          <Button className="w-full">Iniciar sesión</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="corner-brackets rounded-lg border border-border bg-surface p-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />

        <div className="space-y-1.5">
          <Label htmlFor="password">Nueva contraseña</Label>
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
        {!token && <p className="text-sm text-danger">Falta el token del enlace.</p>}

        <Button type="submit" className="w-full" disabled={isPending || !token}>
          {isPending ? "Guardando…" : "Guardar contraseña"}
        </Button>
      </form>
    </div>
  );
}
