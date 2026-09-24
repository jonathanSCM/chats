import { prisma } from "@/server/db/client";
import { hashToken } from "@/lib/tokens";
import { auth } from "@/server/auth";
import { Logo } from "@/components/logo";
import { AcceptInviteForm } from "./accept-invite-form";
import { AcceptWithCurrentSession } from "./accept-with-current-session";

// Consulta la DB en cada visita (valida el token) — nunca debe
// prerenderizarse en build time, cuando la base todavía no es alcanzable.
export const dynamic = "force-dynamic";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const invite = token
    ? await prisma.organizationInvite.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { organization: true },
      })
    : null;

  const isValid = invite && !invite.acceptedAt && invite.expiresAt > new Date();

  // Si ya hay una sesión activa con el mismo correo (o la invitación no
  // apunta a un correo fijo), ofrecemos el camino corto: sumar la
  // membresía nueva sin pedir contraseña de nuevo ni cerrar la sesión
  // actual (ver acceptInviteWithCurrentSessionAction).
  const session = isValid ? await auth() : null;
  const canUseCurrentSession =
    isValid && session?.user?.email && (!invite.email || invite.email === session.user.email);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" className="mb-1" />
          {isValid ? (
            <p className="text-sm text-ink-muted">
              Te invitaron a unirte a <span className="text-ink">{invite.organization.name}</span>
            </p>
          ) : (
            <p className="text-sm text-ink-muted">Invitación</p>
          )}
        </div>

        {isValid && canUseCurrentSession ? (
          <AcceptWithCurrentSession
            token={token!}
            currentEmail={session!.user!.email!}
            organizationName={invite.organization.name}
          />
        ) : isValid ? (
          <AcceptInviteForm token={token!} fixedEmail={invite.email ?? undefined} />
        ) : (
          <div className="corner-brackets rounded-lg border border-border bg-surface p-6 text-center">
            <p className="text-sm text-danger">
              Esta invitación ya no es válida. Pide que te envíen una nueva.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
