import { Logo } from "@/components/logo";
import { VerifyEmailForm } from "./verify-email-form";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" className="mb-1" />
          <p className="text-sm text-ink-muted">Verificación de correo</p>
        </div>

        <VerifyEmailForm token={token ?? ""} />
      </div>
    </main>
  );
}
