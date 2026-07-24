"use client";

import { useTransition } from "react";
import { ShieldOff, ShieldCheck } from "lucide-react";
import { toggleOrgSuspensionAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function SuspendToggle({ orgId, suspended }: { orgId: string; suspended: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant={suspended ? "secondary" : "danger"}
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await toggleOrgSuspensionAction(orgId, !suspended);
        })
      }
    >
      {suspended ? (
        <>
          <ShieldCheck size={14} /> Reactivar
        </>
      ) : (
        <>
          <ShieldOff size={14} /> Suspender
        </>
      )}
    </Button>
  );
}
