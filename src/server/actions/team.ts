"use server";

import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { signIn } from "@/server/auth";
import { generateToken, hashToken } from "@/lib/tokens";
import { sendMail } from "@/server/services/mailer";
import { inviteEmail } from "@/server/services/email-templates";
import type { ActionState } from "./types";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

async function requireOwner() {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    throw new Error("Solo el dueño de la organización puede gestionar el equipo");
  }
  return { organizationId: session.user.organizationId, userId: session.user.id };
}

const inviteSchema = z.object({
  email: z.string().email("Correo inválido").optional(),
  role: z.enum(["OWNER", "MEMBER"]).default("MEMBER"),
});

export async function createInviteAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId } = await requireOwner();

  const parsed = inviteSchema.safeParse({
    email: formData.get("email") || undefined,
    role: formData.get("role") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const { token, tokenHash } = generateToken();
  await prisma.organizationInvite.create({
    data: {
      organizationId,
      email: parsed.data.email,
      role: parsed.data.role,
      tokenHash,
      invitedById: userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  const inviteUrl = `${process.env.NEXTAUTH_URL}/invite?token=${token}`;

  if (parsed.data.email) {
    try {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
      const { subject, text, html } = inviteEmail({ orgName: org.name, inviteUrl });
      await sendMail({ to: parsed.data.email, subject, text, html });
    } catch (error) {
      // No dejamos que un correo caído (dominio sin verificar en Resend,
      // etc.) tumbe la creación de la invitación — igual devolvemos el link
      // para compartirlo a mano mientras se arregla el envío.
      console.error("[team] No se pudo mandar el correo de invitación:", error);
    }
  }

  revalidatePath("/dashboard/organization");
  return { error: null, message: inviteUrl };
}

export async function revokeInviteAction(inviteId: string): Promise<ActionState> {
  const { organizationId } = await requireOwner();

  const invite = await prisma.organizationInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.organizationId !== organizationId) {
    return { error: "Invitación no encontrada" };
  }

  await prisma.organizationInvite.delete({ where: { id: inviteId } });
  revalidatePath("/dashboard/organization");
  return { error: null };
}

export async function removeMemberAction(memberId: string): Promise<ActionState> {
  const { organizationId, userId } = await requireOwner();

  if (memberId === userId) {
    return { error: "No puedes quitarte a ti mismo" };
  }

  const member = await prisma.user.findUnique({ where: { id: memberId } });
  if (!member || member.organizationId !== organizationId) {
    return { error: "Miembro no encontrado" };
  }

  await prisma.user.update({ where: { id: memberId }, data: { organizationId: null } });
  revalidatePath("/dashboard/organization");
  return { error: null };
}

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color inválido");

/**
 * Cualquiera puede fijar su propio color; el dueño además puede fijar el
 * de otros (útil si alguien todavía no entró a elegir el suyo).
 */
export async function updateUserColorAction(userId: string, color: string): Promise<ActionState> {
  const session = await requireSession();
  if (!session.user.organizationId) return { error: "Sin organización" };

  const member = await prisma.user.findUnique({ where: { id: userId } });
  if (!member || member.organizationId !== session.user.organizationId) {
    return { error: "Miembro no encontrado" };
  }

  const isOwner = session.user.role === "OWNER";
  if (userId !== session.user.id && !isOwner) {
    return { error: "No puedes cambiar el color de otro miembro" };
  }

  const parsed = colorSchema.safeParse(color);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Color inválido" };

  await prisma.user.update({ where: { id: userId }, data: { color: parsed.data } });
  revalidatePath("/dashboard/organization");
  return { error: null };
}

const roleSchema = z.enum(["OWNER", "MEMBER"]);

export async function changeMemberRoleAction(
  memberId: string,
  role: "OWNER" | "MEMBER",
): Promise<ActionState> {
  const { organizationId, userId } = await requireOwner();

  if (memberId === userId) {
    return { error: "No puedes cambiar tu propio rol" };
  }

  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) {
    return { error: "Rol inválido" };
  }

  const member = await prisma.user.findUnique({ where: { id: memberId } });
  if (!member || member.organizationId !== organizationId) {
    return { error: "Miembro no encontrado" };
  }

  await prisma.user.update({ where: { id: memberId }, data: { role: parsedRole.data } });
  revalidatePath("/dashboard/organization");
  return { error: null };
}

const acceptSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(2, "Requerido").max(80),
  email: z.string().email("Correo inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
});

export async function acceptInviteAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = acceptSchema.safeParse({
    token: formData.get("token"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const { token, name, email, password } = parsed.data;
  const tokenHash = hashToken(token);
  const invite = await prisma.organizationInvite.findUnique({ where: { tokenHash } });

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return { error: "Esa invitación ya no es válida." };
  }
  if (invite.email && invite.email !== email) {
    return { error: `Esta invitación es solo para ${invite.email}.` };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Ese correo ya tiene una cuenta en WhatsApp ProShop. Inicia sesión en su lugar." };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction([
    prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: invite.role,
        organizationId: invite.organizationId,
        emailVerified: new Date(), // llegó por invitación directa, se toma como verificado
      },
    }),
    prisma.organizationInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Tu cuenta se creó, pero no pudimos iniciar sesión. Entra manualmente." };
    }
    throw error;
  }
}
