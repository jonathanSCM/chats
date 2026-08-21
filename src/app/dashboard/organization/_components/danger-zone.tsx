"use client";

import { useActionState, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { deleteOrganizationAction } from "@/server/actions/organization";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function DangerZone({ orgName }: { orgName: string }) {
  const [state, formAction, isPending] = useActionState(deleteOrganizationAction, { error: null });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink">Exportar todos tus datos</p>
          <p className="text-xs text-ink-muted">
            Contactos, oportunidades, conversaciones y base de conocimiento, en un archivo JSON.
          </p>
        </div>
        <a href="/api/organization/export">
          <Button type="button" variant="secondary">
            <Download size={14} /> Exportar
          </Button>
        </a>
      </div>

      <div className="border-t border-danger/30 pt-5">
        <p className="mb-1 text-sm text-ink">Eliminar la organización</p>
        <p className="mb-3 text-xs text-ink-muted">
          Borra todo — bots, conexiones de WhatsApp, conversaciones, contactos y el equipo entero.
          No se puede deshacer.
        </p>

        {!confirmOpen ? (
          <Button type="button" variant="danger" onClick={() => setConfirmOpen(true)}>
            <Trash2 size={14} /> Eliminar organización
          </Button>
        ) : (
          <form action={formAction} className="max-w-sm space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="confirmName">
                Escribe <span className="font-mono text-ink">{orgName}</span> para confirmar
              </Label>
              <Input
                id="confirmName"
                name="confirmName"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
              />
            </div>
            {state.error && <p className="text-sm text-danger">{state.error}</p>}
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="danger"
                disabled={isPending || confirmName !== orgName}
              >
                {isPending ? "Eliminando…" : "Sí, eliminar todo"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
