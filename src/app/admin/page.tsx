import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { prisma } from "@/server/db/client";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { CreateOrgForm } from "./_components/create-org-form";

export default async function AdminOrganizationsPage() {
  const platformSetting = await prisma.platformSetting.findUnique({ where: { id: "singleton" } });

  const organizations = await prisma.organization.findMany({
    include: {
      bots: { select: { id: true, status: true } },
      users: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = await Promise.all(
    organizations.map(async (org) => ({
      org,
      conversations: await prisma.conversation.count({
        where: { bot: { organizationId: org.id } },
      }),
    })),
  );

  const totalConversations = rows.reduce((sum, r) => sum + r.conversations, 0);
  const totalUsers = organizations.reduce((sum, org) => sum + org.users.length, 0);
  const totalConnected = organizations.reduce(
    (sum, org) => sum + org.bots.filter((b) => b.status === "ACTIVE").length,
    0,
  );

  return (
    <div className="animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Organizaciones</h1>
      <p className="mb-8 text-sm text-ink-muted">Visión global de la plataforma.</p>

      {platformSetting?.aiQuotaAlertAt && (
        <Card className="mb-8 border-danger/40 bg-danger-dim">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
            <div>
              <CardTitle className="mb-1 text-sm text-danger">
                OpenAI se quedó sin créditos — los bots de todos los clientes dejaron de poder responder
              </CardTitle>
              <CardDescription className="text-xs">
                Desde {platformSetting.aiQuotaAlertAt.toLocaleString("es")}. Recargá en{" "}
                <a
                  href="https://platform.openai.com/settings/organization/billing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline hover:opacity-80"
                >
                  platform.openai.com/settings/organization/billing
                </a>{" "}
                — este aviso desaparece solo apenas la próxima llamada a la IA funcione.
                {platformSetting.aiQuotaAlertMessage && (
                  <>
                    <br />
                    <span className="font-mono text-[11px] text-ink-faint">
                      {platformSetting.aiQuotaAlertMessage}
                    </span>
                  </>
                )}
              </CardDescription>
            </div>
          </div>
        </Card>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Organizaciones" value={organizations.length.toString()} />
        <StatCard label="Usuarios" value={totalUsers.toString()} />
        <StatCard label="Números activos" value={totalConnected.toString()} />
        <StatCard label="Conversaciones" value={totalConversations.toLocaleString("es")} />
      </div>

      <Card className="mb-8">
        <CardTitle className="mb-1">Dar de alta un cliente nuevo</CardTitle>
        <CardDescription className="mb-4">
          Crea la organización y un link de invitación para su dueño.
        </CardDescription>
        <CreateOrgForm />
      </Card>

      <Table>
        <Thead>
          <tr>
            <Th>Organización</Th>
            <Th>Estado</Th>
            <Th>Usuarios</Th>
            <Th>Conversaciones</Th>
          </tr>
        </Thead>
        <tbody>
          {rows.map(({ org, conversations }) => (
            <Tr key={org.id}>
              <Td>
                <Link
                  href={`/admin/organizations/${org.id}`}
                  className="font-medium hover:text-accent"
                >
                  {org.name}
                </Link>
                <p className="font-mono text-xs text-ink-faint">{org.slug}</p>
              </Td>
              <Td>
                {org.suspended ? (
                  <Badge tone="danger">
                    <StatusDot tone="danger" />
                    Suspendida
                  </Badge>
                ) : (
                  <Badge tone="accent">
                    <StatusDot tone="accent" />
                    Activa
                  </Badge>
                )}
              </Td>
              <Td className="font-mono">{org.users.length}</Td>
              <Td className="font-mono">{conversations.toLocaleString("es")}</Td>
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
