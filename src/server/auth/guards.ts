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
  const isOrgMember = bot.organizationId === session.user.organizationId;
  if (!isSuperadmin && !isOrgMember) throw new HttpError(403, "Sin acceso a este bot");

  // Un MEMBER (vendedor) solo puede tocar las cuentas de WhatsApp que el
  // dueño le asignó explícitamente (BotMember). OWNER/SUPERADMIN ven y
  // administran todas las cuentas de su organización sin restricción.
  if (!isSuperadmin && session.user.role === "MEMBER") {
    const membership = await prisma.botMember.findUnique({
      where: { botId_userId: { botId, userId: session.user.id } },
    });
    if (!membership) throw new HttpError(403, "No tienes acceso a esta cuenta de WhatsApp");
  }

  return { session, bot };
}

/**
 * Fragmento de filtro Prisma para limitar conversaciones/bots a los que el
 * usuario puede ver. Para OWNER/SUPERADMIN devuelve `{}` (sin restricción,
 * ven toda la organización). Para MEMBER devuelve `{ id: { in: [...] } }`
 * con las cuentas que tiene asignadas — si no tiene ninguna, el `in: []`
 * hace que la consulta no devuelva nada, en vez de fallar o traer de más.
 */
export async function getBotScopeFilter(
  session: Awaited<ReturnType<typeof requireSession>>,
): Promise<Record<string, unknown>> {
  if (session.user.role === "OWNER" || session.user.role === "SUPERADMIN") return {};

  const memberships = await prisma.botMember.findMany({
    where: { userId: session.user.id },
    select: { botId: true },
  });
  return { id: { in: memberships.map((m) => m.botId) } };
}

// Igual que requireBotAccess, pero exige además el rol OWNER dentro de la
// organización (o SUPERADMIN) — para operaciones sensibles como conectar
// WhatsApp, que un MEMBER no debería poder tocar.
export async function requireBotOwnerAccess(botId: string) {
  const { session, bot } = await requireBotAccess(botId);

  const isSuperadmin = session.user.role === "SUPERADMIN";
  const isOwner = session.user.role === "OWNER";
  if (!isSuperadmin && !isOwner) {
    throw new HttpError(403, "Solo el dueño de la organización puede hacer esto");
  }

  return { session, bot };
}
