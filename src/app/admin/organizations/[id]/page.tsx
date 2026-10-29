import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { SuspendToggle } from "./_components/suspend-toggle";
import { JefeToggle } from "./_components/jefe-toggle";
import { DisconnectWhatsAppButton } from "./_components/disconnect-whatsapp-button";
import { PlanForm } from "./_components/plan-form";
import { getSeatCounts } from "@/server/services/org-limits";
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
      parent: { select: { id: true, name: true } },
      children: { select: { id: true, name: true }, orderBy: { createdAt: "asc" } },
      bots: { include: { whatsappConnection: true, _count: { select: { conversations: true } } } },
      integrationKeys: { where: { revokedAt: null }, select: { id: true } },
      integrationWebhooks: { select: { enabled: true, lastSuccessAt: true, lastError: true } },
      memberships: {
        where: { user: { role: { not: "SYSTEM" } } },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!org) notFound();

  const [seats, subOrgs] = await Promise.all([
    getSeatCounts(org.id),
    prisma.organization.count({ where: { parentId: org.id } }),
  ]);

  return (
    <div className="max-w-3xl animate-fade-up">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{org.name}</h1>
          <p className="font-code text-xs text-ink-faint">{org.slug}</p>
          {org.parent && (
            <p className="mt-1 text-xs text-ink-muted">
              Suborganización de{" "}
              <Link href={`/admin/organizations/${org.parent.id}`} className="text-accent hover:underline">
                {org.parent.name}
              </Link>
              . Su plan de usuarios, su marca y su clave de OpenAI son los de la organización principal.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {org.suspended && <Badge tone="danger">Suspendida</Badge>}
          <SuspendToggle orgId={org.id} suspended={org.suspended} />
        </div>
      </div>

      <Card className="mb-6">
        <CardTitle className="mb-1">Plan de la organización</CardTitle>
        <p className="mb-4 text-sm text-ink-muted">
          Qué puede hacer este cliente y hasta cuánto. Solo tú lo ves y lo cambias.
        </p>
        <PlanForm
          orgId={org.id}
          plan={{
            canHaveSubOrgs: org.canHaveSubOrgs,
            maxSubOrgs: org.maxSubOrgs,
            maxAdmins: org.maxAdmins,
            maxSellers: org.maxSellers,
            canCustomizeBrand: org.canCustomizeBrand,
            aiOwnKeyEnabled: org.aiOwnKeyEnabled,
          }}
          usage={{ admins: seats.admins, sellers: seats.sellers, subOrgs }}
        />
      </Card>

      {org.children.length > 0 && (
        <Card className="mb-6">
          <CardTitle className="mb-3">Suborganizaciones</CardTitle>
          <ul className="space-y-1 text-sm">
            {org.children.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/organizations/${c.id}`} className="text-accent hover:underline">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <CardTitle>Jefe de Operaciones</CardTitle>
              <Badge tone={org.jefeEnabled ? "accent" : "neutral"}>
                {org.jefeEnabled ? "Habilitado" : "No habilitado"}
              </Badge>
            </div>
            <p className="text-sm text-ink-muted">
              API de integración, webhooks y tareas en la ficha del caso. Si está deshabilitado la organización no ve la
              sección en Integraciones, la API responde 403 y no salen eventos. No se borra nada: al habilitarlo de
              nuevo todo vuelve a funcionar.
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              {org.integrationKeys.length} clave{org.integrationKeys.length === 1 ? "" : "s"} activa
              {org.integrationKeys.length === 1 ? "" : "s"} ·{" "}
              {org.integrationWebhooks.length === 0
                ? "sin webhook"
                : org.integrationWebhooks[0].enabled
                  ? org.integrationWebhooks[0].lastError
                    ? "webhook activo con errores"
                    : "webhook activo"
                  : "webhook apagado"}
            </p>
          </div>
          <JefeToggle orgId={org.id} enabled={org.jefeEnabled} />
        </div>
      </Card>

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
                  <Td className="">{bot._count.conversations}</Td>
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
        <div className="mb-4 flex items-center justify-between">
          <CardTitle>Usuarios</CardTitle>
          <Link href="/admin/users" className="text-xs text-accent hover:underline">
            Gestionar usuarios
          </Link>
        </div>
        <Table>
          <Thead>
            <tr>
              <Th>Nombre</Th>
              <Th>Correo</Th>
              <Th>Rol</Th>
            </tr>
          </Thead>
          <tbody>
            {org.memberships.map((m) => (
              <Tr key={m.id}>
                <Td>{m.user.name ?? "—"}</Td>
                <Td className="text-ink-muted">{m.user.email}</Td>
                <Td>
                  <Badge tone={m.role === "OWNER" ? "accent" : "neutral"}>{m.role}</Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
