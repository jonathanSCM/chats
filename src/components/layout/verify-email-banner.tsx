"use client";

import { useState, useTransition } from "react";
import { MailWarning } from "lucide-react";
import { resendVerificationEmailAction } from "@/server/actions/email-verification";
import { Button } from "@/components/ui/button";

export function VerifyEmailBanner() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
      <div className="flex items-center gap-2.5 text-sm text-ink">
        <MailWarning size={16} className="shrink-0 text-warning" />
        {message ?? "Verifica tu correo para asegurar tu cuenta."}
      </div>
      {!message && (
        <Button
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              const result = await resendVerificationEmailAction();
              setMessage(result.message ?? result.error ?? null);
            });
          }}
        >
          {isPending ? "Enviando…" : "Reenviar enlace"}
        </Button>
      )}
    </div>
  );
}
