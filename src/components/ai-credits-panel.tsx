import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { featureLabel, formatCredits, creditNoticeText, type CreditLevel } from "@/lib/ai-credits";
import type { CreditUsageSummary, OrgCredits } from "@/server/services/ai/credits";

export interface PackRow {
  id: string;
  credits: number;
  remaining: number;
  expiresAt: Date;
  createdAt: Date;
  note: string | null;
  /** Ya pasó su vigencia (lo calcula el servicio, que conoce la hora). */
  expired: boolean;
}

const LEVEL_BAR: Record<CreditLevel, string> = {
  ok: "bg-accent",
  warn80: "bg-warning",
  warn95: "bg-warning",
  exhausted: "bg-danger",
};

/**
 * Saldo y consumo de créditos de IA de una organización: la barra de uso, la bolsa mensual, los paquetes
 * y el detalle por función, por usuario y por operación. Lo usan el panel del dueño y la pantalla del superadmin.
 * El superadmin además ve el costo real de la API, que el cliente no necesita ver.
 */
export function AiCreditsPanel({
  credits,
  summary,
  packs,
  timeZone,
  showRealCost = false,
  packAction,
  fromParentName,
}: {
  credits: OrgCredits;
  summary: CreditUsageSummary;
  packs: PackRow[];
  timeZone: string;
  showRealCost?: boolean;
  packAction?: (pack: PackRow) => ReactNode;
  /** Si la bolsa es de la organización principal, su nombre (para avisarlo). */
  fromParentName?: string | null;
}) {
  const { balance, level } = credits;
  const notice = creditNoticeText(level, balance);
  const dateFmt = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", year: "numeric", timeZone });
  const dateTimeFmt = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone });

  return (
    <div className="space-y-5">
      {fromParentName && (
        <p className="text-xs text-ink-muted">Los créditos son de la organización principal ({fromParentName}) y se comparten con sus suborganizaciones.</p>
      )}

      <div>
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-ink">
            <b className="text-2xl font-semibold">{formatCredits(balance.available)}</b>{" "}
            <span className="text-ink-muted">créditos disponibles</span>
          </p>
          <p className="text-xs text-ink-faint">Usado: {Math.floor(balance.percentUsed)}%</p>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.floor(balance.percentUsed)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full transition-all ${LEVEL_BAR[level]}`} style={{ width: `${Math.max(balance.percentUsed, balance.percentUsed > 0 ? 2 : 0)}%` }} />
        </div>
        {notice && (
          <p className={`mt-2 text-sm ${level === "exhausted" ? "text-danger" : "text-warning"}`}>{notice}</p>
        )}
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <dt className="text-xs text-ink-faint">Bolsa mensual del plan</dt>
          <dd className="font-medium text-ink">
            {formatCredits(balance.monthlyUsed > (balance.monthlyTotal ?? 0) ? (balance.monthlyTotal ?? 0) : balance.monthlyUsed)} de {formatCredits(balance.monthlyTotal ?? 0)}
          </dd>
          <dd className="text-xs text-ink-faint">Se renueva el {dateFmt.format(credits.renewsAt)}; lo que sobra no se acumula.</dd>
        </div>
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <dt className="text-xs text-ink-faint">Créditos comprados</dt>
          <dd className="font-medium text-ink">{formatCredits(balance.packsRemaining)} disponibles</dd>
          <dd className="text-xs text-ink-faint">Se usan después de la bolsa mensual.</dd>
        </div>
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <dt className="text-xs text-ink-faint">Gastado este mes</dt>
          <dd className="font-medium text-ink">{formatCredits(summary.byFeature.reduce((s, f) => s + f.credits, 0))} créditos</dd>
          {showRealCost && <dd className="text-xs text-ink-faint">Costo real de la API: US$ {summary.realCostUsd.toFixed(2)}</dd>}
        </div>
      </dl>

      {credits.overdraft > 0 && (
        <p className="text-xs text-warning">
          Este mes se usaron {formatCredits(credits.overdraft)} créditos de la reserva de emergencia para que el bot siguiera respondiendo.
        </p>
      )}

      {packs.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-sm font-medium text-ink">Paquetes comprados</h4>
          <ul className="space-y-1.5">
            {packs.map((p) => {
              const expired = p.expired;
              const empty = p.remaining <= 0;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="font-medium text-ink">{formatCredits(p.credits)} créditos</span>
                  <span className="text-ink-muted">· quedan {formatCredits(expired ? 0 : p.remaining)}</span>
                  <span className="text-xs text-ink-faint">
                    · {expired ? "venció" : "vence"} el {dateFmt.format(p.expiresAt)}
                  </span>
                  {p.note && <span className="text-xs text-ink-faint">· {p.note}</span>}
                  {expired ? <Badge tone="neutral">Vencido</Badge> : empty ? <Badge tone="neutral">Agotado</Badge> : null}
                  {packAction && !expired && !empty && <span className="ml-auto">{packAction(p)}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <h4 className="mb-1.5 text-sm font-medium text-ink">Por función (este mes)</h4>
          {summary.byFeature.length === 0 ? (
            <p className="text-sm text-ink-faint">Todavía no se usó la IA este mes.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {summary.byFeature.map((f) => (
                <li key={f.feature} className="flex justify-between gap-3">
                  <span className="text-ink-muted">
                    {featureLabel(f.feature)} <span className="text-xs text-ink-faint">({f.calls})</span>
                  </span>
                  <span className="font-medium text-ink">{formatCredits(f.credits)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="mb-1.5 text-sm font-medium text-ink">Por usuario (este mes)</h4>
          {summary.byUser.length === 0 ? (
            <p className="text-sm text-ink-faint">Sin consumo todavía.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {summary.byUser.map((u) => (
                <li key={u.userId ?? "auto"} className="flex justify-between gap-3">
                  <span className="truncate text-ink-muted">{u.name}</span>
                  <span className="font-medium text-ink">{formatCredits(u.credits)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {summary.recent.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-sm font-medium text-ink">Últimas operaciones</h4>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-2/60 text-ink-faint">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Fecha</th>
                  <th className="px-3 py-1.5 font-medium">Función</th>
                  <th className="px-3 py-1.5 font-medium">Usuario</th>
                  <th className="px-3 py-1.5 text-right font-medium">Créditos</th>
                  {showRealCost && <th className="px-3 py-1.5 text-right font-medium">Costo API</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-1.5 text-ink-muted">{dateTimeFmt.format(r.createdAt)}</td>
                    <td className="px-3 py-1.5 text-ink">
                      {featureLabel(r.feature)}
                      {r.audioMinutes > 0 && <span className="text-ink-faint"> · {r.audioMinutes} min</span>}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted">{r.userName ?? "Automático"}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-ink">{formatCredits(r.credits)}</td>
                    {showRealCost && <td className="px-3 py-1.5 text-right text-ink-muted">US$ {r.costUsd.toFixed(4)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
