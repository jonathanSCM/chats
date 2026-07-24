import { prisma } from "@/server/db/client";
import { hashToken } from "@/lib/tokens";
import { Logo } from "@/components/logo";
import { AcceptInviteForm } from "./accept-invite-form";

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

        {isValid ? (
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
