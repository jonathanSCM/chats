import { prisma } from "@/server/db/client";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { UserOrgManager } from "./_components/user-org-manager";

export default async function AdminUsersPage() {
  const [users, organizations] = await Promise.all([
    prisma.user.findMany({
      where: { role: { not: "SYSTEM" } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        memberships: {
          select: { organizationId: true, role: true, organization: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { email: "asc" },
    }),
    prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Usuarios</h1>
      <p className="mb-8 text-sm text-ink-muted">
        Todos los usuarios de la plataforma y las organizaciones a las que pertenecen. Desde acá podés
        meter o sacar gente y cambiar su rol; cada cambio queda en el Registro.
      </p>

      <Table>
        <Thead>
          <tr>
            <Th>Usuario</Th>
            <Th>Organizaciones</Th>
          </tr>
        </Thead>
        <tbody>
          {users.map((u) => (
            <Tr key={u.id}>
              <Td className="align-top">
                <p className="font-medium">{u.name ?? "—"}</p>
                <p className="text-xs text-ink-muted">{u.email}</p>
                {u.role === "SUPERADMIN" && (
                  <Badge tone="accent" className="mt-1">
                    Superadmin
                  </Badge>
                )}
              </Td>
              <Td>
                {u.role === "SUPERADMIN" ? (
                  <span className="text-xs text-ink-faint">No pertenece a organizaciones</span>
                ) : (
                  <UserOrgManager
                    userId={u.id}
                    userEmail={u.email}
                    memberships={u.memberships.map((m) => ({
                      organizationId: m.organizationId,
                      organizationName: m.organization.name,
                      role: m.role as "OWNER" | "MEMBER",
                    }))}
                    organizations={organizations}
                  />
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
