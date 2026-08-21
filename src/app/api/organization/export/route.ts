import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";

/**
 * Exportación completa de los datos de la organización (derecho de acceso /
 * portabilidad, manual §GDPR-LGPD). Solo el dueño puede pedirla, y solo
 * incluye lo que la organización es dueña de ver — nunca tokens ni hashes
 * de contraseña, aunque estén en las mismas tablas.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.organizationId || session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Solo el dueño de la organización puede exportar estos datos" }, { status: 403 });
  }

  const organizationId = session.user.organizationId;

  const [organization, users, bots, contacts, opportunities, conversations, knowledgeItems] =
    await Promise.all([
      prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { id: true, name: true, slug: true, aiMessageLimit: true, createdAt: true },
      }),
      prisma.user.findMany({
        where: { organizationId },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      }),
      prisma.bot.findMany({
        where: { organizationId },
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          whatsappConnection: {
            select: { phoneNumberId: true, displayNumber: true, verified: true, coexistence: true },
          },
        },
      }),
      prisma.contact.findMany({ where: { organizationId } }),
      prisma.opportunity.findMany({ where: { organizationId } }),
      prisma.conversation.findMany({
        where: { bot: { organizationId } },
        select: {
          id: true,
          customerPhone: true,
          customerName: true,
          startedAt: true,
          status: true,
          tags: true,
          messages: {
            select: {
              role: true,
              content: true,
              mediaType: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
          notes: { select: { body: true, createdAt: true } },
        },
      }),
      prisma.knowledgeItem.findMany({ where: { organizationId } }),
    ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    organization,
    users,
    bots,
    contacts,
    opportunities,
    conversations,
    knowledgeItems,
  };

  const fileName = `datos-${organization.slug}-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
