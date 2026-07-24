import Link from "next/link";
import { prisma } from "@/server/db/client";
import { Logo } from "@/components/logo";
import { SignupForm } from "./signup-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  const organizationCount = await prisma.organization.count();
  const registrationClosed = organizationCount > 0;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" className="mb-1" />
          {registrationClosed ? (
            <p className="text-sm text-ink-muted">
              El registro está cerrado — solo se puede entrar por invitación.
            </p>
          ) : (
            <p className="text-sm text-ink-muted">Crea tu cuenta — 14 días de prueba, sin tarjeta.</p>
          )}
        </div>

        {registrationClosed ? (
          <div className="corner-brackets rounded-lg border border-border bg-surface p-6 text-center">
            <p className="mb-4 text-sm text-ink-muted">
              Si te invitaron al equipo, usa el link que te compartieron. Si no, contacta al
              dueño de la cuenta.
            </p>
            <Link href="/login" className="text-sm text-ink hover:text-accent">
              Ir a iniciar sesión
            </Link>
          </div>
        ) : (
          <SignupForm planId={plan} />
        )}
      </div>
    </main>
  );
}
