"use client";

import { useTransition, useState } from "react";
import { acceptInviteWithCurrentSessionAction } from "@/server/actions/team";
import { Button } from "@/components/ui/button";

export function AcceptWithCurrentSession({
  token,
  currentEmail,
  organizationName,
}: {
  token: string;
  currentEmail: string;
  organizationName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInviteWithCurrentSessionAction(token);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="corner-brackets space-y-3 rounded-lg border border-border bg-surface p-6 text-center">
      <p className="text-sm text-ink-muted">
        Estás con la sesión de <span className="text-ink">{currentEmail}</span> — te unís a{" "}
        <span className="text-ink">{organizationName}</span> con esta misma cuenta, sin salir de la otra.
      </p>
      <Button type="button" className="w-full" disabled={isPending} onClick={accept}>
        {isPending ? "Uniéndote…" : "Unirme con esta cuenta"}
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
