import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { getBusinessProfileForBot } from "@/server/actions/business-profile";
import { getPlatformSettings } from "@/server/services/platform-settings";
import { CopyField } from "./_components/copy-field";
import { BotAccountCard } from "./_components/bot-account-card";
import { CreateBotForm } from "./_components/create-bot-form";
import { Card, CardTitle } from "@/components/ui/card";

// Cada organización puede tener varias cuentas de WhatsApp (varios "bots",
// uno por número/país). El dueño ve y administra todas; un vendedor (MEMBER)
// solo ve las que tiene asignadas en BotMember — misma restricción real que
// aplica en el inbox.
export default async function WhatsAppSettingsPage() {
  const session = await requireSession();
  if (!session.user.organizationId) redirect("/dashboard");

  const organizationId = session.user.organizationId;
  const isOwner = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";

  const allBots = await prisma.bot.findMany({
    where: { organizationId },
    include: { whatsappConnection: true },
    orderBy: { createdAt: "asc" },
  });

  let bots = allBots;
  if (!isOwner) {
    const memberships = await prisma.botMember.findMany({
      where: { userId: session.user.id },
      select: { botId: true },
    });
    const allowed = new Set(memberships.map((m) => m.botId));
    bots = allBots.filter((b) => allowed.has(b.id));
  }

  const webhookUrl = `${process.env.NEXTAUTH_URL ?? ""}/api/webhooks/whatsapp`;
  const platformSettings = await getPlatformSettings();
  const verifyToken = platformSettings.whatsappVerifyToken ?? "";

  // Se pide aparte por cada bot conectado — si Meta falla para uno, no debe
  // tumbar la página entera ni el resto de las cuentas.
  const profiles = await Promise.all(
    bots.map(async (bot) => {
      if (!isOwner || !bot.whatsappConnection?.verified) {
        return { profile: null, error: false };
      }
      try {
        return { profile: await getBusinessProfileForBot(bot.id), error: false };
      } catch (error) {
        console.error(`[whatsapp] No se pudo cargar el perfil de negocio del bot ${bot.id}:`, error);
        return { profile: null, error: true };
      }
    }),
  );

  return (
    <div className="max-w-2xl animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">
        Conexión de WhatsApp
      </h1>
      <p className="mb-8 text-sm text-ink-muted">
        {isOwner
          ? "Conecta los números de WhatsApp Business de tu organización — puedes tener varios."
          : "Cuentas de WhatsApp que tienes asignadas."}
      </p>

      <Card className="mb-6 space-y-4">
        <CardTitle className="text-sm">Configuración del webhook en Meta</CardTitle>
        <CopyField label="Webhook URL (callback URL)" value={webhookUrl} />
        <CopyField label="Identificador de verificación (verify token)" value={verifyToken} />
      </Card>

      {bots.length > 0 && (
        <div className="mb-6 space-y-4">
          {bots.map((bot, i) => (
            <BotAccountCard
              key={bot.id}
              bot={{ id: bot.id, name: bot.name }}
              connection={bot.whatsappConnection}
              isOwner={isOwner}
              businessProfile={profiles[i].profile}
              businessProfileError={profiles[i].error}
            />
          ))}
        </div>
      )}

      {bots.length === 0 && (
        <p className="mb-6 text-sm text-ink-faint">
          {isOwner
            ? "Todavía no hay cuentas de WhatsApp. Agrega la primera abajo."
            : "No tienes ninguna cuenta de WhatsApp asignada — pide al dueño de la organización que te dé acceso."}
        </p>
      )}

      {isOwner && (
        <Card>
          <CreateBotForm />
        </Card>
      )}
    </div>
  );
}
