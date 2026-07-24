import { Logo } from "@/components/logo";
import { SignupForm } from "./signup-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" className="mb-1" />
          <p className="text-sm text-ink-muted">Crea tu cuenta — 14 días de prueba, sin tarjeta.</p>
        </div>

        <SignupForm planId={plan} />
      </div>
    </main>
  );
}
