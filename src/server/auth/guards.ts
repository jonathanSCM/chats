import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new HttpError(401, "No autenticado");
  return session;
}

export async function requireBotAccess(botId: string) {
  const session = await requireSession();

  const bot = await prisma.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new HttpError(404, "Bot no encontrado");

  const isSuperadmin = session.user.role === "SUPERADMIN";
  const isOwner = bot.organizationId === session.user.organizationId;
  if (!isSuperadmin && !isOwner) throw new HttpError(403, "Sin acceso a este bot");

  return { session, bot };
}
