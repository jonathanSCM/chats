import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { LanguageSwitch } from "@/components/language-switch";
import { GoogleCalendarCard } from "../perfil/_components/google-calendar-card";
import { InstallAppCard } from "../perfil/_components/install-app-card";
import { getT } from "@/lib/i18n/server";
import { ExtensionCard } from "./_components/extension-card";
import { checkCalendarConnections } from "@/server/services/google-calendar-user";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ calendarConnected?: string; calendarError?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const t = await getT();

  const { calendarConnected, calendarError } = await searchParams;

  const calendarAccount = await prisma.googleCalendarAccount.findUnique({
    where: { userId: session.user.id },
    select: { googleEmail: true },
  });

  const calendarBroken = calendarAccount
    ? (await checkCalendarConnections([session.user.id])).get(session.user.id) === "broken"
    : false;

  const calendarNotice = calendarConnected
    ? { type: "ok" as const, text: t("Google Calendar conectado — tus próximas reuniones se van a crear ahí.") }
    : calendarError
      ? { type: "error" as const, text: t("No se pudo conectar: {error}", { error: calendarError }) }
      : null;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-1 font-display text-xl font-semibold text-ink">{t("Ajustes")}</h1>
      <p className="mb-6 text-sm text-ink-muted">{t("Preferencias de este dispositivo y conexiones de tu cuenta.")}</p>

      <Card className="mb-6">
        <CardTitle className="mb-1">{t("Idioma")}</CardTitle>
        <CardDescription className="mb-4">
          {t("Idioma de la interfaz. Se guarda en este navegador; las pantallas que todavía no están traducidas siguen en español.")}
        </CardDescription>
        <LanguageSwitch />
      </Card>

      <Card className="mb-6">
        <CardTitle className="mb-1">{t("Google Calendar")}</CardTitle>
        <CardDescription className="mb-4">
          {t("Conecta tu cuenta para que las reuniones que crees se agenden directo en tu calendario (con sincronización en las dos direcciones: lo que edites acá o en Google se refleja del otro lado).")}
        </CardDescription>
        <GoogleCalendarCard connectedEmail={calendarAccount?.googleEmail ?? null} notice={calendarNotice} broken={calendarBroken} />
      </Card>

      <Card className="mb-6">
          <CardTitle className="mb-1">{t("Extensión de Chrome para Meet")}</CardTitle>
          <CardDescription className="mb-4">
            {t("La forma de grabar reuniones de Meet desde tu navegador, con panel propio.")}
          </CardDescription>
          <ExtensionCard />
        </Card>

      <Card className="mb-6">
        <CardTitle className="mb-1">{t("Instalar en mi dispositivo")}</CardTitle>
        <CardDescription className="mb-4">
          {t("Acceso directo en tu pantalla de inicio, pantalla completa y avisos de mensajes nuevos.")}
        </CardDescription>
        <InstallAppCard />
      </Card>
    </div>
  );
}
