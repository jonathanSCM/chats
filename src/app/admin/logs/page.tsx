import { prisma } from "@/server/db/client";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";

const ADMIN_ENTITY_TYPES = ["Organization", "Membership", "WhatsAppConnection", "MetaAds", "PlatformSetting"];

const ACTION_LABEL: Record<string, string> = {
  org_created: "Organización creada",
  org_suspended: "Organización suspendida",
  org_unsuspended: "Organización reactivada",
  member_added: "Usuario agregado",
  member_removed: "Usuario sacado",
  member_role_changed: "Rol cambiado",
  whatsapp_connected: "WhatsApp conectado",
  whatsapp_disconnected: "WhatsApp desconectado",
  meta_ads_connected: "Meta Ads conectado",
  meta_ads_account_selected: "Cuenta de Meta Ads elegida",
  meta_ads_disconnected: "Meta Ads desconectado",
  settings_updated: "Configuración de plataforma editada",
};

const DANGER_ACTIONS = new Set(["org_suspended", "member_removed", "whatsapp_disconnected", "meta_ads_disconnected"]);

function describe(before: unknown, after: unknown): string {
  const parts: string[] = [];
  if (before && typeof before === "object") parts.push(`antes: ${JSON.stringify(before)}`);
  if (after && typeof after === "object") parts.push(JSON.stringify(after));
  return parts.join(" · ");
}

export default async function AdminLogsPage() {
  const logs = await prisma.auditLog.findMany({
    where: { entityType: { in: ADMIN_ENTITY_TYPES } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const userIds = [...new Set(logs.map((l) => l.userId).filter((id): id is string => Boolean(id)))];
  const orgIds = [...new Set(logs.map((l) => l.organizationId).filter((id): id is string => Boolean(id)))];
  const [users, orgs] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }),
    prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }),
  ]);
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  const orgById = new Map(orgs.map((o) => [o.id, o.name]));

  return (
    <div className="animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Registro</h1>
      <p className="mb-8 text-sm text-ink-muted">
        Conexiones, desconexiones y ediciones de administración (últimas 200). Los eventos anteriores a
        esta función no aparecen.
      </p>

      {logs.length === 0 ? (
        <p className="text-sm text-ink-muted">Todavía no hay eventos registrados.</p>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Evento</Th>
              <Th>Organización</Th>
              <Th>Quién</Th>
              <Th>Detalle</Th>
            </tr>
          </Thead>
          <tbody>
            {logs.map((l) => (
              <Tr key={l.id}>
                <Td className="whitespace-nowrap font-mono text-xs">{l.createdAt.toLocaleString("es")}</Td>
                <Td>
                  <Badge tone={DANGER_ACTIONS.has(l.action) ? "danger" : "accent"}>
                    {ACTION_LABEL[l.action] ?? l.action}
                  </Badge>
                </Td>
                <Td className="text-ink-muted">{l.organizationId ? (orgById.get(l.organizationId) ?? "—") : "—"}</Td>
                <Td className="text-ink-muted">{l.userId ? (emailById.get(l.userId) ?? "—") : "Sistema"}</Td>
                <Td className="max-w-xs break-words font-mono text-[11px] text-ink-faint">
                  {describe(l.before, l.after)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
