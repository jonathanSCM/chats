"use client";

import { useState, useTransition } from "react";
import { approveRequestAction, rejectRequestAction } from "@/server/actions/credit-requests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Aprobar (carga los créditos o renueva el plan) o rechazar una solicitud pendiente. */
export function RequestActions({ requestId, kind, summary }: { requestId: string; kind: "CREDITS" | "RENEWAL"; summary: string }) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ error?: string; ok?: string } | null>(null);

  function approve() {
    setResult(null);
    startTransition(async () => {
      const r = await approveRequestAction(requestId);
      setConfirming(false);
      setResult(r.error ? { error: r.error } : { ok: r.message ?? "Listo." });
    });
  }

  function reject() {
    setResult(null);
    startTransition(async () => {
      const r = await rejectRequestAction(requestId, note);
      setRejecting(false);
      setResult(r.error ? { error: r.error } : { ok: r.message ?? "Rechazada." });
    });
  }

  if (result?.ok) return <p className="text-sm text-success">{result.ok}</p>;

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="rounded-md border border-warning/40 bg-warning-dim px-3 py-2 text-sm text-ink">
          ¿Ya recibiste el pago? {kind === "CREDITS" ? `Se cargarán ${summary} (duran 90 días).` : "Se renovará el plan un mes."}
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" onClick={approve} disabled={isPending}>
              {isPending ? "Aplicando…" : kind === "CREDITS" ? "Sí, cargar créditos" : "Sí, renovar"}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : rejecting ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Motivo (opcional)" className="max-w-xs py-1.5 text-sm" />
          <Button type="button" size="sm" variant="danger" onClick={reject} disabled={isPending}>
            Rechazar
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setRejecting(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => setConfirming(true)}>
            {kind === "CREDITS" ? "Aprobar y cargar" : "Aprobar y renovar"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setRejecting(true)}>
            Rechazar
          </Button>
        </div>
      )}
      {result?.error && <p className="text-sm text-danger">{result.error}</p>}
    </div>
  );
}
