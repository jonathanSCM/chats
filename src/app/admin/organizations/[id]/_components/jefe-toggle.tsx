"use client";

import { useState, useTransition } from "react";
import { toggleOrgJefeAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function JefeToggle({ orgId, enabled }: { orgId: string; enabled: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Solo se confirma apagar (corta la API y los avisos al instante); habilitar es de un toque,
  // mismo patrón que Suspender/Reactivar en esta pantalla.
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant={enabled ? "danger" : "secondary"}
        size="sm"
        disabled={isPending}
        onClick={() => {
          if (enabled && !confirm) {
            setConfirm(true);
            setTimeout(() => setConfirm(false), 3000);
            return;
          }
          setConfirm(false);
          setError(null);
          startTransition(async () => {
            const r = await toggleOrgJefeAction(orgId, !enabled);
            if (r.error) setError(r.error);
          });
        }}
      >
        {enabled ? (confirm ? "¿Seguro? Toca de nuevo" : "Deshabilitar") : "Habilitar"}
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
