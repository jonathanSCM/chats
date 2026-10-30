import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCredits } from "@/lib/ai-credits";
import { listRequests } from "@/server/services/credit-requests";
import { RequestActions } from "./_components/request-actions";

const dateFmt = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function AdminRequestsPage() {
  const [pending, resolved] = await Promise.all([
    listRequests({ status: "PENDING", limit: 100 }),
    listRequests({ status: "RESOLVED", limit: 20 }),
  ]);

  return (
    <div className="max-w-3xl animate-fade-up">
      <h1 className="mb-1 text-2xl font-bold">Solicitudes</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Lo que piden los dueños de las organizaciones: más créditos de IA o renovar su plan. El pago lo coordinas por otro medio; al aprobar, se
        cargan los créditos o se renueva el plan y al dueño le queda el aviso.
      </p>

      <h2 className="mb-3 text-sm font-semibold text-ink">
        Pendientes <span className="font-normal text-ink-faint">({pending.length})</span>
      </h2>
      {pending.length === 0 ? (
        <Card className="mb-8 text-sm text-ink-muted">No hay solicitudes pendientes.</Card>
      ) : (
        <div className="mb-8 space-y-3">
          {pending.map((r) => {
            const summary = r.kind === "CREDITS" ? `${formatCredits(r.credits ?? 0)} créditos` : "Renovar el plan";
            return (
              <Card key={r.id} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">
                      <Link href={`/admin/organizations/${r.organizationId}`} className="hover:text-accent hover:underline">
                        {r.organizationName}
                      </Link>{" "}
                      <span className="text-ink-muted">pide {r.kind === "CREDITS" ? summary : "renovar su plan"}</span>
                    </p>
                    <p className="text-xs text-ink-faint">
                      {dateFmt.format(r.createdAt)}
                      {r.requestedBy ? ` · ${r.requestedBy}` : ""}
                    </p>
                  </div>
                  <Badge tone={r.kind === "CREDITS" ? "accent" : "warning"}>{r.kind === "CREDITS" ? "Créditos" : "Renovación"}</Badge>
                </div>
                {r.note && <p className="rounded-md bg-surface-2/60 px-3 py-2 text-sm text-ink-muted">“{r.note}”</p>}
                <RequestActions requestId={r.id} kind={r.kind} summary={summary} />
              </Card>
            );
          })}
        </div>
      )}

      {resolved.length > 0 && (
        <>
          <h2 className="mb-3 text-sm font-semibold text-ink">Atendidas recientemente</h2>
          <Card>
            <ul className="divide-y divide-border text-sm">
              {resolved.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <Link href={`/admin/organizations/${r.organizationId}`} className="font-medium text-ink hover:text-accent hover:underline">
                    {r.organizationName}
                  </Link>
                  <span className="text-ink-muted">{r.kind === "CREDITS" ? `${formatCredits(r.credits ?? 0)} créditos` : "Renovación"}</span>
                  <Badge tone={r.status === "APPROVED" ? "accent" : "neutral"}>{r.status === "APPROVED" ? "Aprobada" : "Rechazada"}</Badge>
                  <span className="ml-auto text-xs text-ink-faint">{r.resolvedAt ? dateFmt.format(r.resolvedAt) : ""}</span>
                  {r.resolvedNote && <span className="w-full text-xs text-ink-faint">Motivo: {r.resolvedNote}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
