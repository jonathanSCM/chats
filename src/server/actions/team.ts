"use server";

import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { auth, signIn } from "@/server/auth";
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

  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: memberId, organizationId } },
  });
  if (!membership) {
    return { error: "Miembro no encontrado" };
  }

  await prisma.organizationMembership.delete({ where: { id: membership.id } });

  // Si esta era su organización ACTIVA, no puede quedar apuntando a una
  // organización de la que ya no es miembro -- pasa a otra que le quede, o
  // queda "huérfano" (organizationId null) si no le queda ninguna, igual
  // que el comportamiento de siempre para alguien sin ninguna organización.
  const member = await prisma.user.findUnique({ where: { id: memberId }, select: { organizationId: true } });
  if (member?.organizationId === organizationId) {
    const another = await prisma.organizationMembership.findFirst({ where: { userId: memberId } });
    await prisma.user.update({
      where: { id: memberId },
      data: another
        ? { organizationId: another.organizationId, role: another.role }
        : { organizationId: null },
    });
  }

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

  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId: session.user.organizationId } },
  });
  if (!membership) {
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

  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: memberId, organizationId } },
  });
  if (!membership) {
    return { error: "Miembro no encontrado" };
  }

  // El rol es por organización -- se actualiza la membresía de ESTA
  // organización, y además User.role si esta es la que tiene activa ahora
  // mismo (para que su sesión ya refleje el rol nuevo sin re-loguear).
  await prisma.organizationMembership.update({ where: { id: membership.id }, data: { role: parsedRole.data } });
  const member = await prisma.user.findUnique({ where: { id: memberId }, select: { organizationId: true } });
  if (member?.organizationId === organizationId) {
    await prisma.user.update({ where: { id: memberId }, data: { role: parsedRole.data } });
  }

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
    const alreadyMember = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: existing.id, organizationId: invite.organizationId } },
    });
    if (alreadyMember) {
      return { error: "Ese correo ya es miembro de esta organización. Inicia sesión en su lugar." };
    }

    // Ya tiene actividad real en otra organización -- este formulario asume
    // que está fijando una contraseña, y no podemos dejar que le pise la que
    // ya tiene sin probar identidad primero. Si ya está logueado con este
    // correo, InvitePage ofrece un camino más corto que no pasa por acá
    // (ver acceptInviteWithCurrentSessionAction).
    const hasOtherMemberships = (await prisma.organizationMembership.count({ where: { userId: existing.id } })) > 0;
    if (hasOtherMemberships) {
      return {
        error: "Ese correo ya tiene una cuenta. Inicia sesión con tu contraseña y volvé a abrir este link para unirte.",
      };
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    // Cuenta que existía pero no tenía ninguna organización (huérfana, o
    // recién creada sin invitación aceptar) -- se reactiva acá, fijando
    // contraseña nueva, igual que siempre.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, name, role: invite.role, organizationId: invite.organizationId },
      }),
      prisma.organizationMembership.create({
        data: { userId: existing.id, organizationId: invite.organizationId, role: invite.role },
      }),
      prisma.organizationInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
  } else {
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: invite.role,
        organizationId: invite.organizationId,
        emailVerified: new Date(), // llegó por invitación directa, se toma como verificado
      },
    });
    await prisma.$transaction([
      prisma.organizationMembership.create({
        data: { userId: created.id, organizationId: invite.organizationId, role: invite.role },
      }),
      prisma.organizationInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
  }

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

/**
 * Camino corto para cuando quien abre el link de invitación YA tiene una
 * sesión activa (el caso típico: un dueño logueado en la organización A
 * abre la invitación que le mandaron a la B) -- no pide contraseña de
 * nuevo, solo agrega la membresía nueva y la deja como activa. Ver
 * src/app/invite/page.tsx para cuándo se ofrece este camino en vez del
 * formulario de acceptInviteAction.
 */
export async function acceptInviteWithCurrentSessionAction(token: string): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.email || !session.user.id) {
    return { error: "Iniciá sesión primero." };
  }

  const tokenHash = hashToken(token);
  const invite = await prisma.organizationInvite.findUnique({ where: { tokenHash } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return { error: "Esa invitación ya no es válida." };
  }
  if (invite.email && invite.email !== session.user.email) {
    return { error: `Esta invitación es solo para ${invite.email}.` };
  }

  const alreadyMember = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: session.user.id, organizationId: invite.organizationId } },
  });
  if (alreadyMember) {
    return { error: "Ya sos miembro de esta organización." };
  }

  await prisma.$transaction([
    prisma.organizationMembership.create({
      data: { userId: session.user.id, organizationId: invite.organizationId, role: invite.role },
    }),
    prisma.user.update({
      where: { id: session.user.id },
      data: { organizationId: invite.organizationId, role: invite.role },
    }),
    prisma.organizationInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ]);

  // Mismo cuidado que switchOrganizationAction: invalida toda la app, no
  // solo /dashboard, para que el router del cliente no muestre una versión
  // en caché de una página que ya tenía abierta con la organización vieja.
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
