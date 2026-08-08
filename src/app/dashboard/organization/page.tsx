import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { RenameOrgForm } from "./_components/rename-org-form";
import { MembersList } from "./_components/members-list";
import { InvitePanel } from "./_components/invite-panel";
import { AiSettingsForm } from "./_components/ai-settings-form";

export default async function OrganizationSettingsPage() {
  const session = await auth();
  if (!session?.user.organizationId) redirect("/dashboard");
  if (session.user.role !== "OWNER") redirect("/dashboard");

  const [org, members, invites] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: session.user.organizationId } }),
    prisma.user.findMany({
      where: { organizationId: session.user.organizationId },
      select: { id: true, name: true, email: true, role: true, color: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.organizationInvite.findMany({
      where: { organizationId: session.user.organizationId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="max-w-2xl animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Organización</h1>
      <p className="mb-8 text-sm text-ink-muted">Datos, equipo e invitaciones.</p>

      <Card className="mb-6">
        <CardTitle className="mb-4">Nombre</CardTitle>
        <RenameOrgForm currentName={org.name} />
      </Card>

      <Card className="mb-6">
        <CardTitle className="mb-1">Asesor IA</CardTitle>
        <CardDescription className="mb-4">
          Cuánto contexto de la conversación recibe el asesor al analizar un cliente.
        </CardDescription>
        <AiSettingsForm currentLimit={org.aiMessageLimit} />
      </Card>

      <Card className="mb-6">
        <CardTitle className="mb-1">Equipo</CardTitle>
        <CardDescription className="mb-4">
          Todos los que tienen acceso a tus bots y conversaciones.
        </CardDescription>
        <MembersList members={members} currentUserId={session.user.id} />
      </Card>

      <Card>
        <CardTitle className="mb-1">Invitar a alguien</CardTitle>
        <CardDescription className="mb-4">
          Genera un enlace y compártelo — quien lo abra se une como miembro.
        </CardDescription>
        <InvitePanel
          invites={invites.map((i) => ({
            id: i.id,
            email: i.email,
            expiresAt: i.expiresAt.toISOString(),
          }))}
        />
      </Card>
    </div>
  );
}
