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
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Un <a href> plano no da ningún indicio de progreso — con una org
  // grande la exportación puede tardar y parece que "no pasó nada",
  // invitando a clickear varias veces. Se arma el blob a mano para poder
  // mostrar un estado de carga real.
  async function handleExport() {
    setIsExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/organization/export");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] ?? "export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("No se pudo exportar. Intenta de nuevo.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink">Exportar todos tus datos</p>
          <p className="text-xs text-ink-muted">
            Contactos, oportunidades, conversaciones y base de conocimiento, en un archivo JSON.
          </p>
          {exportError && <p className="mt-1 text-xs text-danger">{exportError}</p>}
        </div>
        <Button type="button" variant="secondary" disabled={isExporting} onClick={handleExport}>
          <Download size={14} /> {isExporting ? "Exportando…" : "Exportar"}
        </Button>
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
