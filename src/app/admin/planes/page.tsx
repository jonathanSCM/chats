import Link from "next/link";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { describePlan, formatPriceSoles } from "@/lib/plans";
import { listPlans } from "@/server/services/plans";
import { PlanEditor } from "./_components/plan-editor";

export default async function AdminPlansPage() {
  const plans = await listPlans();

  // Facturación mensual anotada: precio de cada plan × organizaciones activas (las suspendidas no cuentan).
  const monthly = plans.reduce(
    (sum, p) => sum + (p.priceSoles ?? 0) * p.organizations.filter((o) => !o.suspended).length,
    0,
  );
  const withPrice = plans.filter((p) => p.priceSoles !== null).length;

  return (
    <div className="max-w-3xl animate-fade-up">
      <h1 className="mb-1 text-2xl font-bold">Planes</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Lo que incluye cada plan y cuánto cuesta al mes. Al editar un plan, el cambio se aplica a todas las organizaciones que lo
        tienen y a sus dueños les sale un aviso. El precio solo se anota: el cobro se hace por otro medio.
      </p>

      {withPrice > 0 && (
        <Card className="mb-6">
          <CardTitle className="mb-1">Facturación mensual anotada</CardTitle>
          <p className="text-2xl font-semibold text-ink">{formatPriceSoles(monthly)}</p>
          <CardDescription>Suma de los precios de los planes por cada organización activa que los tiene.</CardDescription>
        </Card>
      )}

      {plans.map((p) => {
        const active = p.organizations.filter((o) => !o.suspended).length;
        return (
          <Card key={p.id} className="mb-6">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>{p.name}</CardTitle>
                <p className="text-sm text-ink-muted">{formatPriceSoles(p.priceSoles)} al mes</p>
              </div>
              <Badge tone={p.organizations.length > 0 ? "accent" : "neutral"}>
                {p.organizations.length} organización{p.organizations.length === 1 ? "" : "es"}
                {active !== p.organizations.length ? ` (${active} activa${active === 1 ? "" : "s"})` : ""}
              </Badge>
            </div>
            <p className="mb-4 text-xs text-ink-faint">{describePlan(p.values).join(" · ")}</p>

            {p.organizations.length > 0 && (
              <p className="mb-4 text-sm text-ink-muted">
                Clientes:{" "}
                {p.organizations.map((o, i) => (
                  <span key={o.id}>
                    {i > 0 && ", "}
                    <Link href={`/admin/organizations/${o.id}`} className="text-accent hover:underline">
                      {o.name}
                    </Link>
                  </span>
                ))}
              </p>
            )}

            <PlanEditor plan={{ id: p.id, name: p.name, priceSoles: p.priceSoles, values: p.values, orgCount: p.organizations.length }} />
          </Card>
        );
      })}

      <Card>
        <CardTitle className="mb-1">Crear un plan</CardTitle>
        <CardDescription className="mb-4">Por ejemplo: GLA, S/ 249, hasta 5 usuarios y 8.000 créditos de IA al mes.</CardDescription>
        <PlanEditor />
      </Card>
    </div>
  );
}
