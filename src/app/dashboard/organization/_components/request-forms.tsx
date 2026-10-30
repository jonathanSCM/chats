"use client";

import { useActionState, useState } from "react";
import { requestCreditsAction, requestRenewalAction } from "@/server/actions/credit-requests";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { CREDIT_PACKS, formatCredits } from "@/lib/ai-credits";

export interface PendingRequestView {
  id: string;
  kind: "CREDITS" | "RENEWAL";
  credits: number | null;
  createdAt: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

function RequestsList({ requests }: { requests: PendingRequestView[] }) {
  if (requests.length === 0) return null;
  const fmt = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const label = { PENDING: "Pendiente", APPROVED: "Atendida", REJECTED: "Rechazada" } as const;
  return (
    <ul className="space-y-1 text-xs text-ink-muted">
      {requests.map((r) => (
        <li key={r.id} className="flex flex-wrap gap-x-2">
          <span className="font-medium text-ink">{r.kind === "RENEWAL" ? "Renovar el plan" : `${formatCredits(r.credits ?? 0)} créditos`}</span>
          <span>· {fmt.format(new Date(r.createdAt))}</span>
          <span className={r.status === "PENDING" ? "text-warning" : r.status === "APPROVED" ? "text-success" : "text-ink-faint"}>· {label[r.status]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Pedir más créditos de IA: elige un paquete o escribe una cantidad. La solicitud le llega al administrador de la plataforma. */
export function RequestCreditsForm({ requests }: { requests: PendingRequestView[] }) {
  const [state, formAction, isPending] = useActionState(requestCreditsAction, { error: null });
  const [credits, setCredits] = useState("");
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  if (state.message && !state.error && state.message !== lastMessage) {
    setLastMessage(state.message);
    setCredits("");
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <h4 className="text-sm font-medium text-ink">Solicitar más créditos</h4>
        <p className="text-xs text-ink-muted">
          Elige un paquete o escribe una cantidad. El administrador de la plataforma recibe tu solicitud, coordina el pago contigo y carga los
          créditos. Los créditos comprados duran 90 días y se usan después de los del mes.
        </p>
      </div>
      <form action={formAction} className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {CREDIT_PACKS.map((p) => (
            <button
              key={p.credits}
              type="button"
              onClick={() => setCredits(String(p.credits))}
              className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors ${
                credits === String(p.credits) ? "border-accent-dim bg-accent-dim/10 text-accent" : "border-border text-ink-muted hover:border-accent-dim hover:text-ink"
              }`}
            >
              {formatCredits(p.credits)} · S/ {p.priceSoles}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="req-credits">Cantidad de créditos</Label>
            <Input id="req-credits" name="credits" type="number" min={100} step={1} value={credits} onChange={(e) => setCredits(e.target.value)} required />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="req-note">Mensaje (opcional)</Label>
            <Input id="req-note" name="note" maxLength={300} placeholder="Ej. Pagaré por Yape hoy" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={isPending || !credits}>
            {isPending ? "Enviando…" : "Enviar solicitud"}
          </Button>
          {state.error && <p className="text-sm text-danger">{state.error}</p>}
          {!state.error && state.message && <p className="text-sm text-success">{state.message}</p>}
        </div>
      </form>
      <RequestsList requests={requests.filter((r) => r.kind === "CREDITS")} />
    </div>
  );
}

/** Pedir la renovación del plan (cuando está por vencer o ya venció). */
export function RequestRenewalForm({ requests, highlight }: { requests: PendingRequestView[]; highlight: boolean }) {
  const [state, formAction, isPending] = useActionState(requestRenewalAction, { error: null });
  const pending = requests.some((r) => r.kind === "RENEWAL" && r.status === "PENDING");

  return (
    <div className={`space-y-2 rounded-lg border p-4 ${highlight ? "border-warning/50 bg-warning-dim/40" : "border-border"}`}>
      <div>
        <h4 className="text-sm font-medium text-ink">Renovar el plan</h4>
        <p className="text-xs text-ink-muted">Avisa al administrador de la plataforma para que renueve tu plan un mes más una vez coordinado el pago.</p>
      </div>
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <Input name="note" maxLength={300} placeholder="Mensaje (opcional)" className="max-w-xs py-1.5 text-sm" />
        <Button type="submit" size="sm" disabled={isPending || pending}>
          {pending ? "Solicitud pendiente" : isPending ? "Enviando…" : "Pedir renovación"}
        </Button>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {!state.error && state.message && <p className="text-sm text-success">{state.message}</p>}
      </form>
      <RequestsList requests={requests.filter((r) => r.kind === "RENEWAL")} />
    </div>
  );
}
