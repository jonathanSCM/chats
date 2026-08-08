import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { SuspendToggle } from "./_components/suspend-toggle";
import { DisconnectWhatsAppButton } from "./_components/disconnect-whatsapp-button";
import type { BotStatus } from "@/generated/prisma/enums";

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
      bots: { include: { whatsappConnection: true, _count: { select: { conversations: true } } } },
      users: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  if (!org) notFound();

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

      <Card className="mb-6">
        <CardTitle className="mb-4">Números de WhatsApp</CardTitle>
        {org.bots.length === 0 ? (
          <p className="text-sm text-ink-muted">Esta organización no tiene números conectados.</p>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>Nombre</Th>
                <Th>Estado</Th>
                <Th>WhatsApp</Th>
                <Th>Conversaciones</Th>
                <Th />
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
                  <Td>
                    {bot.whatsappConnection && <DisconnectWhatsAppButton botId={bot.id} />}
                  </Td>
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
