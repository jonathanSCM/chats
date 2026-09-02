"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession, HttpError } from "@/server/auth/guards";
import { uniqueOrgSlug } from "@/lib/slugify";
import { generateToken } from "@/lib/tokens";
import { sendMail } from "@/server/services/mailer";
import { inviteEmail } from "@/server/services/email-templates";
import type { ActionState } from "./types";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días — mismo plazo que las invitaciones normales de equipo.

async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") {
    throw new HttpError(403, "Solo el superadmin puede hacer esto");
  }
  return session;
}

const createOrgSchema = z.object({
  companyName: z.string().min(2, "Requerido").max(120),
  ownerEmail: z.string().email("Correo inválido").optional(),
});

/**
 * Da de alta un cliente nuevo en la plataforma: crea la organización (vacía,
 * sin bots ni datos) y una invitación de OWNER — el mismo mecanismo que ya
 * usa "Invitar a alguien" dentro de una organización existente
 * (team.ts:createInviteAction / acceptInviteAction), así el dueño nuevo pone
 * su propia contraseña al aceptar, en vez de que el superadmin tenga que
 * inventarle una.
 */
export async function createOrganizationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSuperadmin();

  const parsed = createOrgSchema.safeParse({
    companyName: formData.get("companyName"),
    ownerEmail: formData.get("ownerEmail") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const slug = await uniqueOrgSlug(parsed.data.companyName);
  const { token, tokenHash } = generateToken();

  const org = await prisma.$transaction(async (tx) => {
    const newOrg = await tx.organization.create({ data: { name: parsed.data.companyName, slug } });
    await tx.organizationInvite.create({
      data: {
        organizationId: newOrg.id,
        email: parsed.data.ownerEmail,
        role: "OWNER",
        tokenHash,
        invitedById: session.user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    return newOrg;
  });

  const inviteUrl = `${process.env.NEXTAUTH_URL}/invite?token=${token}`;

  if (parsed.data.ownerEmail) {
    try {
      const { subject, text, html } = inviteEmail({ orgName: org.name, inviteUrl });
      await sendMail({ to: parsed.data.ownerEmail, subject, text, html });
    } catch (error) {
      // Igual que en team.ts: un correo caído no debe tumbar la creación —
      // el link queda disponible para compartirlo a mano.
      console.error("[admin] No se pudo mandar el correo de invitación a la organización nueva:", error);
    }
  }

  revalidatePath("/admin");
  return { error: null, message: inviteUrl };
}

export async function toggleOrgSuspensionAction(
  orgId: string,
  suspended: boolean,
): Promise<ActionState> {
  await requireSuperadmin();

  await prisma.organization.update({ where: { id: orgId }, data: { suspended } });

  revalidatePath(`/admin/organizations/${orgId}`);
  revalidatePath("/admin");
  return { error: null };
}

/**
 * Borra solo la conexión de WhatsApp de un bot (token, phone_number_id,
 * waba_id) para poder volver a intentar Embedded Signup desde cero. No
 * toca la organización, el bot, sus conversaciones ni ningún otro dato.
 */
export async function disconnectWhatsAppAction(botId: string): Promise<ActionState> {
  await requireSuperadmin();

  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { organizationId: true } });
  if (!bot) return { error: "Bot no encontrado" };

  await prisma.whatsAppConnection.deleteMany({ where: { botId } });

  revalidatePath(`/admin/organizations/${bot.organizationId}`);
  return { error: null, message: "Conexión de WhatsApp eliminada." };
}
