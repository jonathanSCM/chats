"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction } from "@/server/actions/login";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, { error: null });

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" className="mb-1" />
          <p className="text-sm text-ink-muted">Bandeja de conversaciones de WhatsApp</p>
        </div>

        <div className="corner-brackets rounded-lg border border-border bg-surface p-6">
          <form action={formAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Correo</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                <Link href="/forgot-password" className="text-xs text-ink-faint hover:text-accent">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>

            {state.error && (
              <p className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-sm text-danger">
                {state.error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Ingresando…" : "Ingresar"}
            </Button>
          </form>
        </div>

      </div>
    </main>
  );
}
