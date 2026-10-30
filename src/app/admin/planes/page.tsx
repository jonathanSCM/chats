import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { describePlan, formatPrice, sumByCurrency } from "@/lib/plans";
import { CreditsExplainer } from "@/components/credits-explainer";
import { listPlans } from "@/server/services/plans";
import { CreatePlanButton, EditPlanButton } from "./_components/plan-dialogs";

export default async function AdminPlansPage() {
  const plans = await listPlans();

  // Facturación mensual anotada: precio de cada plan × organizaciones activas (las suspendidas no cuentan).
  const monthly = sumByCurrency(
    plans.map((p) => ({ price: p.price, currency: p.currency, clients: p.organizations.filter((o) => !o.suspended).length })),
  );
  const clients = plans.reduce((sum, p) => sum + p.organizations.length, 0);

  return (
    <div className="max-w-5xl animate-fade-up">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="mb-1 text-2xl font-bold">Planes</h1>
          <p className="text-sm text-ink-muted">
            Lo que incluye cada plan y cuánto cuesta al mes. Al editar un plan, el cambio se aplica a todos los clientes que lo tienen y a
            sus dueños les sale un aviso. El precio solo se anota: el cobro se hace por otro medio.
          </p>
        </div>
        <CreatePlanButton />
      </div>

      <div className="mb-6">
        <CreditsExplainer />
      </div>

      {plans.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs text-ink-faint">Planes</p>
            <p className="text-xl font-semibold text-ink">{plans.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-ink-faint">Clientes con plan</p>
            <p className="text-xl font-semibold text-ink">{clients}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-ink-faint">Facturación mensual anotada</p>
            <p className="text-xl font-semibold text-ink">
              {monthly.length === 0 ? formatPrice(0, "PEN") : monthly.map((m) => formatPrice(m.total, m.currency)).join(" + ")}
            </p>
          </Card>
        </div>
      )}

      {plans.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="mb-1 font-medium text-ink">Todavía no hay planes</p>
          <p className="mb-4 text-sm text-ink-muted">Crea el primero, por ejemplo GLA con su precio, usuarios y créditos de IA.</p>
          <div className="flex justify-center">
            <CreatePlanButton />
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => {
            const includes = describePlan(p.values);
            const active = p.organizations.filter((o) => !o.suspended).length;
            return (
              <Card key={p.id} className="flex flex-col">
                <div className="mb-4 flex items-start justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold text-ink">{p.name}</h2>
                  <Badge tone={p.organizations.length > 0 ? "accent" : "neutral"}>
                    {p.organizations.length} cliente{p.organizations.length === 1 ? "" : "s"}
                  </Badge>
                </div>

                <p className="mb-4">
                  <span className="text-3xl font-semibold text-ink">{formatPrice(p.price, p.currency)}</span>
                  {p.price !== null && <span className="text-sm text-ink-muted"> /mes</span>}
                </p>

                <ul className="mb-4 flex-1 space-y-1.5 text-sm text-ink-muted">
                  {includes.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Check size={14} className="mt-0.5 shrink-0 text-accent" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                {p.organizations.length > 0 && (
                  <p className="mb-4 text-xs text-ink-faint">
                    {p.organizations
                      .slice(0, 3)
                      .map((o) => o.name)
                      .join(", ")}
                    {p.organizations.length > 3 ? ` y ${p.organizations.length - 3} más` : ""}
                    {active !== p.organizations.length ? ` · ${active} activo${active === 1 ? "" : "s"}` : ""}
                  </p>
                )}

                <EditPlanButton
                  plan={{ id: p.id, name: p.name, price: p.price, currency: p.currency, values: p.values, orgCount: p.organizations.length }}
                  includes={includes}
                  clients={p.organizations}
                />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
