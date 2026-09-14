"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import type { ActionState } from "./types";

const nameSchema = z.object({
  name: z.string().trim().min(1, "Poné tu nombre").max(120),
});

export async function updateMyNameAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name },
  });

  revalidatePath("/dashboard/perfil");
  return { error: null, message: "Nombre actualizado." };
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Ingresá tu contraseña actual"),
    newPassword: z.string().min(8, "Mínimo 8 caracteres"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Las contraseñas nuevas no coinciden",
    path: ["confirmPassword"],
  });

/**
 * A diferencia de resetPasswordAction (password-reset.ts, vía correo para
 * quien no puede loguearse), esto es de alguien ya logueado que sí sabe su
 * contraseña actual -- por eso se le pide de nuevo, en vez de solo confiar
 * en la sesión activa.
 */
export async function changeMyPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });
  if (!user.passwordHash || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return { error: "La contraseña actual no es correcta." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash },
  });

  return { error: null, message: "Contraseña actualizada." };
}
