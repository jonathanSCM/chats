import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { SettingsForm } from "./_components/settings-form";

export default async function AdminSettingsPage() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") redirect("/dashboard");

  const row = await prisma.platformSetting.findUnique({ where: { id: "singleton" } });

  return (
    <div className="max-w-xl animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Configuración</h1>
      <p className="mb-8 text-sm text-ink-muted">
        Credenciales de la app de Meta que usa toda la plataforma para Coexistence / Embedded
        Signup. Se guardan cifradas en la base de datos — cambiarlas aquí no requiere redesplegar.
      </p>

      <Card className="space-y-4">
        <div>
          <CardTitle className="text-sm">App de Meta (WhatsApp)</CardTitle>
          <CardDescription>
            Del dashboard de tu app en{" "}
            <a
              href="https://developers.facebook.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:opacity-80"
            >
              developers.facebook.com
            </a>
            .
          </CardDescription>
        </div>
        <SettingsForm
          whatsappAppId={row?.whatsappAppId ?? ""}
          whatsappConfigId={row?.whatsappConfigId ?? ""}
          whatsappVerifyToken={row?.whatsappVerifyToken ?? ""}
          hasAppSecret={Boolean(row?.whatsappAppSecret)}
        />
      </Card>
    </div>
  );
}
