import { Logo } from "@/components/logo";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
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
          <p className="text-sm text-ink-muted">Elige tu nueva contraseña</p>
        </div>

        <ResetPasswordForm token={token ?? ""} />
      </div>
    </main>
  );
}
