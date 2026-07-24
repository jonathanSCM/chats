"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signupAction } from "@/server/actions/signup";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function SignupForm({ planId }: { planId?: string }) {
  const [state, formAction, isPending] = useActionState(signupAction, { error: null });

  return (
    <>
      <div className="corner-brackets rounded-lg border border-border bg-surface p-6">
        <form action={formAction} className="space-y-4">
          {planId && <input type="hidden" name="planId" value={planId} />}

          <div className="space-y-1.5">
            <Label htmlFor="name">Tu nombre</Label>
            <Input id="name" name="name" required autoComplete="name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="companyName">Empresa</Label>
            <Input id="companyName" name="companyName" required autoComplete="organization" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
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

          <label className="flex items-start gap-2 text-xs text-ink-muted">
            <input type="checkbox" name="acceptedTerms" required className="mt-0.5" />
            <span>
              Acepto los{" "}
              <Link href="/terms" target="_blank" className="text-ink hover:text-accent">
                términos de servicio
              </Link>{" "}
              y la{" "}
              <Link href="/privacy" target="_blank" className="text-ink hover:text-accent">
                política de privacidad
              </Link>
              .
            </span>
          </label>

          {state.error && (
            <p className="rounded-md border border-danger/40 bg-danger-dim px-3 py-2 text-sm text-danger">
              {state.error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? "Creando cuenta…" : "Crear cuenta"}
          </Button>
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-ink-muted">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="text-ink hover:text-accent">
          Inicia sesión
        </Link>
      </p>
    </>
  );
}
