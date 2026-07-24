"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordResetAction } from "@/server/actions/password-reset";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default function ForgotPasswordPage() {
  const [state, formAction, isPending] = useActionState(requestPasswordResetAction, {
    error: null,
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" className="mb-1" />
          <p className="text-sm text-ink-muted">Recuperar contraseña</p>
        </div>

        <div className="corner-brackets rounded-lg border border-border bg-surface p-6">
          {state.message ? (
            <p className="text-sm text-ink">{state.message}</p>
          ) : (
            <form action={formAction} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Correo</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </div>

              {state.error && <p className="text-sm text-danger">{state.error}</p>}

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? "Enviando…" : "Enviar enlace"}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-sm text-ink-muted">
          <Link href="/login" className="text-ink hover:text-accent">
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
