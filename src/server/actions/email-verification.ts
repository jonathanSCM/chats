"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { generateToken, hashToken } from "@/lib/tokens";
import { sendMail } from "@/server/services/mailer";
import type { ActionState } from "./bots";

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const { token, tokenHash } = generateToken();
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash, expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS) },
  });

  const verifyUrl = `${process.env.NEXTAUTH_URL}/verify-email?token=${token}`;
  await sendMail({
    to: email,
    subject: "Verifica tu correo en Zócalo",
    text: `Confirma tu correo entrando a este enlace (vence en 24 horas):\n\n${verifyUrl}`,
  });
}

export async function resendVerificationEmailAction(): Promise<ActionState> {
  const session = await requireSession();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });

  if (user.emailVerified) {
    return { error: null, message: "Tu correo ya está verificado." };
  }

  await sendVerificationEmail(user.id, user.email);
  return { error: null, message: "Te reenviamos el enlace de verificación." };
}

const verifySchema = z.object({ token: z.string().min(1) });

export async function verifyEmailAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = verifySchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) {
    return { error: "Falta el token del enlace." };
  }

  const tokenHash = hashToken(parsed.data.token);
  const verificationToken = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
  });

  if (!verificationToken || verificationToken.usedAt || verificationToken.expiresAt < new Date()) {
    return { error: "Ese enlace ya no es válido. Pide uno nuevo desde tu panel." };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: verificationToken.userId },
      data: { emailVerified: new Date() },
    }),
    prisma.emailVerificationToken.update({
      where: { id: verificationToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  revalidatePath("/dashboard");
  return { error: null, message: "Correo verificado." };
}
