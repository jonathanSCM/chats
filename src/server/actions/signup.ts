"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { signIn } from "@/server/auth";
import { slugify } from "@/lib/slugify";
import type { ActionState } from "./bots";

const TRIAL_DAYS = 14;
const DEFAULT_PLAN_NAME = "Starter";

const signupSchema = z.object({
  name: z.string().min(2, "Requerido").max(80),
  companyName: z.string().min(2, "Requerido").max(120),
  email: z.string().email("Correo inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
  planId: z.string().optional(),
  acceptedTerms: z.literal("on", {
    error: "Debes aceptar los términos de servicio y la política de privacidad",
  }),
});

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "empresa";
  let candidate = root;
  let suffix = 1;

  while (await prisma.organization.findUnique({ where: { slug: candidate } })) {
    suffix += 1;
    candidate = `${root}-${suffix}`;
  }

  return candidate;
}

export async function signupAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    companyName: formData.get("companyName"),
    email: formData.get("email"),
    password: formData.get("password"),
    planId: formData.get("planId") || undefined,
    acceptedTerms: formData.get("acceptedTerms"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const { name, companyName, email, password, planId } = parsed.data;

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

  const plan = planId
    ? await prisma.plan.findFirst({ where: { id: planId, active: true } })
    : await prisma.plan.findFirst({ where: { name: DEFAULT_PLAN_NAME, active: true } });
  if (!plan) {
    return { error: "No hay planes disponibles en este momento. Contacta soporte." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const slug = await uniqueSlug(companyName);

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + TRIAL_DAYS);

  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: companyName, slug } });

    await tx.user.create({
      data: { email, passwordHash, name, role: "OWNER", organizationId: org.id },
    });

    await tx.subscription.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        status: "TRIALING",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
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
