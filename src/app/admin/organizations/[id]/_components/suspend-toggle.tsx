"use client";

import { useState, useTransition } from "react";
import { ShieldOff, ShieldCheck } from "lucide-react";
import { toggleOrgSuspensionAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function SuspendToggle({ orgId, suspended }: { orgId: string; suspended: boolean }) {
  const [isPending, startTransition] = useTransition();
  // Solo se confirma suspender (corta el bot de un cliente pagante para
  // toda la organización) — reactivar es de un solo toque, mismo patrón
  // que desconectar WhatsApp en esta misma pantalla.
  const [confirm, setConfirm] = useState(false);

  return (
    <Button
      variant={suspended ? "secondary" : "danger"}
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!suspended && !confirm) {
          setConfirm(true);
          setTimeout(() => setConfirm(false), 3000);
          return;
        }
        setConfirm(false);
        startTransition(async () => {
          await toggleOrgSuspensionAction(orgId, !suspended);
        });
      }}
    >
      {suspended ? (
        <>
          <ShieldCheck size={14} /> Reactivar
        </>
      ) : (
        <>
          <ShieldOff size={14} /> {confirm ? "¿Seguro? Toca de nuevo" : "Suspender"}
        </>
      )}
    </Button>
  );
}
