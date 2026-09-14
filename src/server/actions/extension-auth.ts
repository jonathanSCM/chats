"use server";

import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";

/**
 * Token personal de la extensión de subtítulos de Meet -- se genera solo,
 * la primera vez que hace falta, reusando la sesión ya iniciada del CRM
 * (ver /dashboard/extension-authorize). Antes esto era un token único por
 * organización que había que generar a mano, copiar y pegar en la
 * extensión; ahora es automático y por persona, así además queda registrado
 * quién grabó cada reunión.
 */
export async function getOrCreateMyExtensionTokenAction(): Promise<{
  token: string;
  name: string | null;
}> {
  const session = await requireSession();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { meetExtensionToken: true, name: true },
  });

  if (user.meetExtensionToken) {
    return { token: user.meetExtensionToken, name: user.name };
  }

  const token = `mext_${randomBytes(24).toString("hex")}`;
  await prisma.user.update({
    where: { id: session.user.id },
    data: { meetExtensionToken: token },
  });

  return { token, name: user.name };
}
