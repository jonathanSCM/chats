import Link from "next/link";
import { prisma } from "@/server/db/client";
import { getUsageStatus } from "@/server/services/subscription";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import type { SubscriptionStatus } from "@/generated/prisma/enums";

const statusTone: Record<SubscriptionStatus, "accent" | "warning" | "danger" | "neutral"> = {
  ACTIVE: "accent",
  TRIALING: "accent",
  PAST_DUE: "warning",
  CANCELED: "danger",
};

const statusLabel: Record<SubscriptionStatus, string> = {
  ACTIVE: "Activa",
  TRIALING: "Prueba",
  PAST_DUE: "Pago pendiente",
  CANCELED: "Cancelada",
};

const currency = new Intl.NumberFormat("es", { style: "currency", currency: "USD" });

export default async function AdminOrganizationsPage() {
  const organizations = await prisma.organization.findMany({
    include: {
      subscription: { include: { plan: true } },
      bots: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = await Promise.all(
    organizations.map(async (org) => {
      const usage = org.subscription
        ? await getUsageStatus(org.subscription.id, org.subscription.plan.conversationLimit)
        : null;
      return { org, usage };
    }),
  );

  const totalOrgs = organizations.length;
  const totalActiveBots = organizations.reduce(
    (sum, org) => sum + org.bots.filter((b) => b.status === "ACTIVE").length,
    0,
  );
  const mrrCents = organizations.reduce(
    (sum, org) => sum + (org.subscription?.status === "ACTIVE" ? org.subscription.plan.priceCents : 0),
    0,
  );
  const totalConversations = rows.reduce((sum, r) => sum + (r.usage?.consumed ?? 0), 0);

  return (
    <div className="animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Organizaciones</h1>
      <p className="mb-8 text-sm text-ink-muted">Visión global de todos los clientes.</p>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Organizaciones" value={totalOrgs.toString()} />
        <StatCard label="Bots activos" value={totalActiveBots.toString()} />
        <StatCard label="MRR" value={currency.format(mrrCents / 100)} />
        <StatCard label="Conversaciones (período)" value={totalConversations.toLocaleString("es")} />
      </div>

      <Table>
        <Thead>
          <tr>
            <Th>Organización</Th>
            <Th>Plan</Th>
            <Th>Estado</Th>
            <Th>Uso</Th>
            <Th>Bots</Th>
          </tr>
        </Thead>
        <tbody>
          {rows.map(({ org, usage }) => (
            <Tr key={org.id}>
              <Td>
                <Link href={`/admin/organizations/${org.id}`} className="font-medium hover:text-accent">
                  {org.name}
                </Link>
                <p className="font-mono text-xs text-ink-faint">{org.slug}</p>
              </Td>
              <Td>{org.subscription?.plan.name ?? "—"}</Td>
              <Td>
                {org.subscription ? (
                  <Badge tone={statusTone[org.subscription.status]}>
                    <StatusDot tone={statusTone[org.subscription.status]} />
                    {statusLabel[org.subscription.status]}
                  </Badge>
                ) : (
                  <Badge tone="neutral">Sin suscripción</Badge>
                )}
              </Td>
              <Td className="font-mono">
                {usage ? `${usage.consumed} / ${usage.allowed}` : "—"}
              </Td>
              <Td className="font-mono">{org.bots.length}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardDescription className="mb-2 font-mono text-[11px] uppercase tracking-wide">
        {label}
      </CardDescription>
      <CardTitle className="font-mono text-2xl">{value}</CardTitle>
    </Card>
  );
}
