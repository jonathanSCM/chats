import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { WhatsAppTab } from "./_components/whatsapp-tab";

// En esta variante no hay concepto de "bots" a nivel de UI: cada
// organización tiene un único número de WhatsApp conectado por debajo.
export default async function WhatsAppSettingsPage() {
  const session = await requireSession();
  if (!session.user.organizationId) redirect("/dashboard");

  const isOwner = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";

  let bot = await prisma.bot.findFirst({
    where: { organizationId: session.user.organizationId },
    include: { whatsappConnection: true },
  });

  // Crear/activar el bot contenedor es un detalle de infraestructura — solo
  // lo hace el dueño; un MEMBER solo puede ver el estado, nunca tocarlo.
  if (isOwner) {
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
  }

  return (
    <div className="max-w-2xl animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">
        Conexión de WhatsApp
      </h1>
      <p className="mb-8 text-sm text-ink-muted">
        {isOwner
          ? "Conecta el número de WhatsApp Business de tu organización."
          : "Solo el dueño de la organización puede conectar o cambiar el número de WhatsApp."}
      </p>
      {bot ? (
        <WhatsAppTab botId={bot.id} connection={bot.whatsappConnection} readOnly={!isOwner} />
      ) : (
        <p className="text-sm text-ink-faint">
          Todavía no hay WhatsApp configurado. Pide al dueño de la cuenta que lo conecte.
        </p>
      )}
    </div>
  );
}
