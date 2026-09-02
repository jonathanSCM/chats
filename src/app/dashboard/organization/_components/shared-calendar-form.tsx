"use client";

import { useActionState, useState, useTransition } from "react";
import { X } from "lucide-react";
import { shareOrgCalendarAction, unshareOrgCalendarAction } from "@/server/actions/organization";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function SharedCalendarForm({ sharedEmails }: { sharedEmails: string[] }) {
  const [state, formAction, isPending] = useActionState(shareOrgCalendarAction, { error: null });
  const [isRemoving, startTransition] = useTransition();
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  function handleRemove(email: string) {
    setRemovingEmail(email);
    startTransition(async () => {
      await unshareOrgCalendarAction(email);
      setRemovingEmail(null);
    });
  }

  return (
    <div className="space-y-3">
      {sharedEmails.length > 0 && (
        <ul className="space-y-1.5">
          {sharedEmails.map((email) => (
            <li key={email} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
              <span className="truncate">{email}</span>
              <button
                type="button"
                disabled={isRemoving && removingEmail === email}
                onClick={() => handleRemove(email)}
                className="shrink-0 cursor-pointer text-ink-faint hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                title="Sacar acceso"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="flex items-end gap-3">
        <div className="flex-1">
          <Input type="email" name="email" placeholder="correo@ejemplo.com" required />
        </div>
        <Button type="submit" variant="secondary" disabled={isPending}>
          {isPending ? "Compartiendo…" : "Compartir"}
        </Button>
      </form>
      {state.message && <p className="text-xs text-accent">{state.message}</p>}
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </div>
  );
}
