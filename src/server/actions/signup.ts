"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { signIn } from "@/server/auth";
import { uniqueOrgSlug } from "@/lib/slugify";
import { getClientIp, rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import type { ActionState } from "./types";

const signupSchema = z.object({
  name: z.string().min(2, "Requerido").max(80),
  companyName: z.string().min(2, "Requerido").max(120),
  email: z.string().email("Correo inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
  acceptedTerms: z.literal("on", {
    error: "Debes aceptar los términos de servicio y la política de privacidad",
  }),
});

export async function signupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ip = await getClientIp();
  const byIp = rateLimit(`signup:ip:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!byIp.allowed) return { error: rateLimitMessage(byIp.retryAfterSec) };

  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    companyName: formData.get("companyName"),
    email: formData.get("email"),
    password: formData.get("password"),
    acceptedTerms: formData.get("acceptedTerms"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const { name, companyName, email, password } = parsed.data;

  // Registro cerrado: solo la primera cuenta se crea así. Después de eso,
  // sumar gente pasa únicamente por invitación (/invite).
  const organizationCount = await prisma.organization.count();
  if (organizationCount > 0) {
    return {
      error: "El registro está cerrado. Pide una invitación al equipo para unirte.",
    };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Ese correo ya está registrado" };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const slug = await uniqueOrgSlug(companyName);

  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: companyName, slug } });

    await tx.user.create({
      data: { email, passwordHash, name, role: "OWNER", organizationId: org.id },
    });
  });

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Tu cuenta se creó, pero no pudimos iniciar sesión. Intenta entrar manualmente." };
    }
    throw error; // NEXT_REDIRECT debe propagarse
  }
}
