import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PLAN_STATE_LABEL, type PlanState } from "@/lib/plan-period";

const STATE_TONE: Record<PlanState, "accent" | "warning" | "danger" | "neutral"> = {
  none: "neutral",
  active: "accent",
  expiring: "warning",
  grace: "warning",
  expired: "danger",
};

/** Fecha de plan "30 nov 2026": en UTC, igual que como el superadmin la fija. */
export function planDateLabel(date: Date): string {
  return date.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Qué plan tiene la organización, hasta cuándo está activo y qué incluye. Lo ven el dueño (en su panel) y, con el mismo
 * formato, sirve de referencia al superadmin. `children` es el lugar para los botones de solicitud.
 */
export function PlanSummaryCard({
  planName,
  state,
  daysLeft,
  endsAt,
  startedAt,
  includes,
  creditsRenewAt,
  fromParentName,
  children,
}: {
  planName: string | null;
  state: PlanState;
  daysLeft: number | null;
  endsAt: Date | null;
  startedAt: Date | null;
  includes: string[];
  creditsRenewAt: Date | null;
  fromParentName?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {fromParentName && <p className="text-xs text-ink-muted">Es el plan de la organización principal ({fromParentName}); aplica también a sus suborganizaciones.</p>}

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-semibold text-ink">{planName ?? "A medida"}</p>
        {planName && <Badge tone={STATE_TONE[state]}>{PLAN_STATE_LABEL[state]}</Badge>}
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <dt className="text-xs text-ink-faint">Activo desde</dt>
          <dd className="font-medium text-ink">{startedAt ? planDateLabel(startedAt) : "—"}</dd>
        </div>
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <dt className="text-xs text-ink-faint">Activo hasta</dt>
          <dd className="font-medium text-ink">{endsAt ? planDateLabel(endsAt) : "Sin fecha de vencimiento"}</dd>
          {endsAt && daysLeft !== null && (
            <dd className="text-xs text-ink-faint">
              {daysLeft > 0 ? (daysLeft === 1 ? "queda 1 día" : `quedan ${daysLeft} días`) : daysLeft === 0 ? "vence hoy" : `venció hace ${Math.abs(daysLeft)} día${Math.abs(daysLeft) === 1 ? "" : "s"}`}
            </dd>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <dt className="text-xs text-ink-faint">Los créditos de IA se renuevan</dt>
          <dd className="font-medium text-ink">{creditsRenewAt ? planDateLabel(creditsRenewAt) : "—"}</dd>
          <dd className="text-xs text-ink-faint">cada mes; lo que sobra no se acumula</dd>
        </div>
      </dl>

      {includes.length > 0 && (
        <ul className="grid gap-1.5 text-sm text-ink-muted sm:grid-cols-2">
          {includes.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Check size={14} className="mt-0.5 shrink-0 text-accent" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      {children}
    </div>
  );
}
