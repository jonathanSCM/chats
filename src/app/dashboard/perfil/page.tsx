import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { NameForm } from "./_components/name-form";
import { PasswordForm } from "./_components/password-form";
import { ColorPicker } from "./_components/color-picker";
import { getT } from "@/lib/i18n/server";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const t = await getT();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, color: true },
  });

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-1 font-display text-xl font-semibold text-ink">{t("Mi perfil")}</h1>
      <p className="mb-6 text-sm text-ink-muted">{user.email}</p>

      <Card className="mb-6">
        <CardTitle className="mb-1">{t("Nombre")}</CardTitle>
        <CardDescription className="mb-4">
          {t("Cómo te ven tus compañeros en el CRM (chats asignados, notas, reuniones).")}
        </CardDescription>
        <NameForm currentName={user.name ?? ""} />
      </Card>

      <Card className="mb-6">
        <CardTitle className="mb-1">{t("Color")}</CardTitle>
        <CardDescription className="mb-4">
          {t("Te identifica de un vistazo en la bandeja y en Seguimiento.")}
        </CardDescription>
        <ColorPicker userId={user.id} currentColor={user.color} />
      </Card>

      <Card className="mb-6">
        <CardTitle className="mb-1">{t("Contraseña")}</CardTitle>
        <CardDescription className="mb-4">
          {t("Pedimos la actual para confirmar que sos vos, aunque ya tengas sesión iniciada.")}
        </CardDescription>
        <PasswordForm />
      </Card>

      <p className="text-sm text-ink-muted">
        {t("El idioma, Google Calendar y la instalación en tu dispositivo están en")}{" "}
        <Link href="/dashboard/ajustes" className="font-medium text-accent underline">
          {t("Ajustes")}
        </Link>
        .
      </p>
    </div>
  );
}
