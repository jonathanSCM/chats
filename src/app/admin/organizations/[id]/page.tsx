import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getUsageStatus } from "@/server/services/subscription";
import { Card, CardTitle, CardDescription, CardHeader } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { UsageMeter } from "@/components/ui/usage-meter";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { SuspendToggle } from "./_components/suspend-toggle";
import { ChangePlanForm } from "./_components/change-plan-form";
import { GrantExtraForm } from "./_components/grant-extra-form";
import type { SubscriptionStatus, BotStatus } from "@/generated/prisma/enums";

const subStatusTone: Record<SubscriptionStatus, "accent" | "warning" | "danger"> = {
  ACTIVE: "accent",
  TRIALING: "accent",
  PAST_DUE: "warning",
  CANCELED: "danger",
};

const botStatusTone: Record<BotStatus, "accent" | "warning" | "neutral"> = {
  ACTIVE: "accent",
  PAUSED: "warning",
  DRAFT: "neutral",
};

export default async function AdminOrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      subscription: { include: { plan: true } },
      bots: { include: { whatsappConnection: true, _count: { select: { conversations: true } } } },
      users: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  if (!org) notFound();

  const [plans, usage] = await Promise.all([
    prisma.plan.findMany({ where: { active: true }, orderBy: { priceCents: "asc" } }),
    org.subscription
      ? getUsageStatus(org.subscription.id, org.subscription.plan.conversationLimit)
      : null,
  ]);

  return (
    <div className="max-w-3xl animate-fade-up">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{org.name}</h1>
          <p className="font-mono text-xs text-ink-faint">{org.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          {org.suspended && <Badge tone="danger">Suspendida</Badge>}
          <SuspendToggle orgId={org.id} suspended={org.suspended} />
        </div>
      </div>

      {org.subscription && usage && (
        <Card className="mb-6">
          <CardHeader>
            <div>
              <CardTitle>Plan {org.subscription.plan.name}</CardTitle>
              <CardDescription className="mt-1 font-mono text-xs">
                Modelo: {org.subscription.plan.aiModel}
              </CardDescription>
            </div>
            <Badge tone={subStatusTone[org.subscription.status]}>
              <StatusDot tone={subStatusTone[org.subscription.status]} />
              {org.subscription.status}
            </Badge>
          </CardHeader>

          <UsageMeter consumed={usage.consumed} allowed={usage.allowed} label="Uso del período" />

          <div className="mt-6 space-y-4 border-t border-border pt-4">
            <ChangePlanForm
              orgId={org.id}
              plans={plans.map((p) => ({ id: p.id, name: p.name }))}
              currentPlanId={org.subscription.plan.id}
            />
            <GrantExtraForm orgId={org.id} />
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <CardTitle className="mb-4">Bots</CardTitle>
        {org.bots.length === 0 ? (
          <p className="text-sm text-ink-muted">Esta organización no tiene bots.</p>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>Nombre</Th>
                <Th>Estado</Th>
                <Th>WhatsApp</Th>
                <Th>Conversaciones</Th>
              </tr>
            </Thead>
            <tbody>
              {org.bots.map((bot) => (
                <Tr key={bot.id}>
                  <Td>{bot.name}</Td>
                  <Td>
                    <Badge tone={botStatusTone[bot.status]}>
                      <StatusDot tone={botStatusTone[bot.status]} />
                      {bot.status}
                    </Badge>
                  </Td>
                  <Td className="text-ink-muted">
                    {bot.whatsappConnection?.verified ? "Conectado" : "Sin conectar"}
                  </Td>
                  <Td className="font-mono">{bot._count.conversations}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardTitle className="mb-4">Usuarios</CardTitle>
        <Table>
          <Thead>
            <tr>
              <Th>Nombre</Th>
              <Th>Correo</Th>
              <Th>Rol</Th>
            </tr>
          </Thead>
          <tbody>
            {org.users.map((user) => (
              <Tr key={user.id}>
                <Td>{user.name ?? "—"}</Td>
                <Td className="text-ink-muted">{user.email}</Td>
                <Td>
                  <Badge tone={user.role === "OWNER" ? "accent" : "neutral"}>{user.role}</Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
