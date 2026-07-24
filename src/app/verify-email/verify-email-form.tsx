"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { verifyEmailAction } from "@/server/actions/email-verification";
import { Button } from "@/components/ui/button";

export function VerifyEmailForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(verifyEmailAction, { error: null });
  const autoSubmitted = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (token && !autoSubmitted.current) {
      autoSubmitted.current = true;
      formRef.current?.requestSubmit();
    }
  }, [token]);

  return (
    <div className="corner-brackets rounded-lg border border-border bg-surface p-6 text-center">
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="token" value={token} />
      </form>

      {!token && <p className="text-sm text-danger">Falta el token del enlace.</p>}
      {token && isPending && <p className="text-sm text-ink-muted">Verificando…</p>}
      {state.message && <p className="mb-4 text-sm text-ink">{state.message}</p>}
      {state.error && <p className="mb-4 text-sm text-danger">{state.error}</p>}

      {(state.message || state.error) && (
        <Link href="/dashboard">
          <Button className="w-full">Ir al panel</Button>
        </Link>
      )}
    </div>
  );
}
