import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { LanguageSwitch } from "@/components/language-switch";
import { GoogleCalendarCard } from "../perfil/_components/google-calendar-card";
import { InstallAppCard } from "../perfil/_components/install-app-card";
import { getT } from "@/lib/i18n/server";
import { loadMeetScripts } from "@/lib/meet-scripts";
import { MeetScriptCard } from "./_components/meet-script-card";
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
  const meetScripts = await loadMeetScripts();

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

      {meetScripts.length > 0 && (
        <Card className="mb-6">
          <CardTitle className="mb-1">{t("Scripts para Meet")}</CardTitle>
          <CardDescription className="mb-4">
            {t("Para instalarlos: abre Tampermonkey en Chrome → «Crear un nuevo script», borra lo que trae, pega el script completo y guarda (Ctrl+S). Si ya lo tenías, reemplaza el código por la versión nueva.")}
          </CardDescription>
          <div className="space-y-3">
            {meetScripts.map((script) => (
              <MeetScriptCard
                key={script.id}
                title={script.title}
                description={script.description}
                file={script.file}
                version={script.version}
                code={script.code}
              />
            ))}
          </div>
        </Card>
      )}

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
