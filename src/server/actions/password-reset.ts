"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { generateToken, hashToken } from "@/lib/tokens";
import { sendMail } from "@/server/services/mailer";
import { passwordResetEmail } from "@/server/services/email-templates";
import { getClientIp, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import type { ActionState } from "./types";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora
const GENERIC_SUCCESS =
  "Si ese correo existe en WhatsApp ProShop, te enviamos un enlace para restablecer tu contraseña.";

const requestSchema = z.object({ email: z.string().email("Correo inválido") });

export async function requestPasswordResetAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = requestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const ip = await getClientIp();
  const byIp = rateLimit(`pwreset-req:ip:${ip}`, { limit: 8, windowMs: 60 * 60 * 1000 });
  if (!byIp.allowed) return { error: rateLimitMessage(byIp.retryAfterSec) };

  const byEmail = rateLimit(`pwreset-req:email:${parsed.data.email.toLowerCase()}`, {
    limit: 3,
    windowMs: 60 * 60 * 1000,
  });
  // Mismo mensaje "genérico" que el éxito real, para no revelar si el correo existe.
  if (!byEmail.allowed) return { error: null, message: GENERIC_SUCCESS };

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  // Nunca revelamos si el correo existe o no: siempre el mismo mensaje.
  if (user) {
    const { token, tokenHash } = generateToken();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });

    const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${token}`;
    const { subject, text, html } = passwordResetEmail({ resetUrl });
    try {
      await sendMail({ to: user.email, subject, text, html });
    } catch (error) {
      // No revelamos el fallo al usuario (mismo mensaje genérico de siempre)
      // pero sí lo dejamos registrado — sin esto, un correo caído tumbaba
      // toda la página de "olvidé mi contraseña".
      console.error("[password-reset] No se pudo mandar el correo:", error);
    }
  }

  return { error: null, message: GENERIC_SUCCESS };
}

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Mínimo 8 caracteres"),
});

export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const ip = await getClientIp();
  const byIp = rateLimit(`pwreset-confirm:ip:${ip}`, { limit: 15, windowMs: 60 * 60 * 1000 });
  if (!byIp.allowed) return { error: rateLimitMessage(byIp.retryAfterSec) };

  const tokenHash = hashToken(parsed.data.token);
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return { error: "Ese enlace ya no es válido. Pide uno nuevo." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return { error: null, message: "Contraseña actualizada." };
}
