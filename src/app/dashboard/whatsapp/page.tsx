import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { WhatsAppTab } from "../bots/[botId]/_components/whatsapp-tab";

// En esta variante no hay concepto de "bots" a nivel de UI: cada
// organización tiene un único número de WhatsApp conectado por debajo.
export default async function WhatsAppSettingsPage() {
  const session = await requireSession();
  if (!session.user.organizationId) redirect("/dashboard");

  let bot = await prisma.bot.findFirst({
    where: { organizationId: session.user.organizationId },
    include: { whatsappConnection: true },
  });

  if (!bot) {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: session.user.organizationId },
    });
    bot = await prisma.bot.create({
      data: { organizationId: org.id, name: org.name, status: "ACTIVE" },
      include: { whatsappConnection: true },
    });
  } else if (bot.status !== "ACTIVE") {
    bot = await prisma.bot.update({
      where: { id: bot.id },
      data: { status: "ACTIVE" },
      include: { whatsappConnection: true },
    });
  }

  return (
    <div className="max-w-2xl animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">
        Conexión de WhatsApp
      </h1>
      <p className="mb-8 text-sm text-ink-muted">
        Conecta el número de WhatsApp Business de tu organización.
      </p>
      <WhatsAppTab botId={bot.id} connection={bot.whatsappConnection} />
    </div>
  );
}
