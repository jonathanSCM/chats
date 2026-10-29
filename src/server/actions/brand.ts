"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { audit } from "@/server/services/audit";
import {
  MAX_LOGO_BYTES,
  detectLogoType,
  isHexColor,
  isUsableBrandColor,
  clampLogoScale,
  parseBrandDisplay,
  parseLogoShape,
} from "@/lib/brand";
import type { ActionState } from "./types";

const textSchema = z.object({
  brandName: z.string().trim().max(60, "El nombre admite hasta 60 caracteres"),
  assistantName: z.string().trim().max(40, "El nombre del asistente admite hasta 40 caracteres"),
  brandColor: z.string().trim(),
});

/**
 * Marca propia de la organización: nombre, color, nombre del asistente y logo. Solo el dueño, y
 * solo si el superadmin habilitó `canCustomizeBrand` en el plan de esta organización.
 */
export async function updateBrandAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    return { error: "Solo el dueño de la organización puede cambiar la marca." };
  }
  const organizationId = session.user.organizationId;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      canCustomizeBrand: true,
      brandName: true,
      brandColor: true,
      assistantName: true,
      brandLogoVersion: true,
      brandDisplay: true,
      brandLogoShape: true,
      brandLogoScale: true,
    },
  });
  if (!org) return { error: "Organización no encontrada." };
  if (!org.canCustomizeBrand) return { error: "Tu plan no incluye cambiar la marca." };

  const parsed = textSchema.safeParse({
    brandName: formData.get("brandName") ?? "",
    assistantName: formData.get("assistantName") ?? "",
    brandColor: formData.get("brandColor") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const { brandName, assistantName, brandColor } = parsed.data;
  if (brandColor) {
    if (!isHexColor(brandColor)) return { error: "El color debe ser del tipo #1d4ed8." };
    if (!isUsableBrandColor(brandColor)) {
      return { error: "Ese color es muy claro: el texto blanco de los botones no se leería. Elige uno más oscuro." };
    }
  }

  // Logo: opcional. Se valida por su contenido real, no por el nombre ni por el tipo que dice el navegador.
  const file = formData.get("logo");
  const removeLogo = formData.get("removeLogo") === "on";
  let newLogo: { data: Uint8Array<ArrayBuffer>; contentType: string } | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_LOGO_BYTES) {
      return { error: `El logo pesa demasiado (máximo ${Math.round(MAX_LOGO_BYTES / 1024)} KB).` };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = detectLogoType(bytes);
    if (!contentType) return { error: "El logo debe ser una imagen PNG, JPG o WebP." };
    newLogo = { data: bytes, contentType };
  }

  const brandDisplay = parseBrandDisplay(formData.get("brandDisplay"));
  const brandLogoShape = parseLogoShape(formData.get("brandLogoShape"));
  const brandLogoScale = clampLogoScale(formData.get("brandLogoScale") ?? 100);
  const nextVersion = newLogo ? org.brandLogoVersion + 1 : removeLogo ? 0 : org.brandLogoVersion;

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: organizationId },
      data: {
        brandName: brandName || null,
        assistantName: assistantName || null,
        brandColor: brandColor || null,
        brandLogoVersion: nextVersion,
        brandDisplay,
        brandLogoShape,
        brandLogoScale,
      },
    });
    if (newLogo) {
      await tx.organizationBrandLogo.upsert({
        where: { organizationId },
        create: { organizationId, ...newLogo },
        update: newLogo,
      });
    } else if (removeLogo) {
      await tx.organizationBrandLogo.deleteMany({ where: { organizationId } });
    }
  });

  await audit({
    entityType: "Organization",
    entityId: organizationId,
    action: "brand_updated",
    userId: session.user.id,
    organizationId,
    before: {
      brandName: org.brandName,
      brandColor: org.brandColor,
      assistantName: org.assistantName,
      brandDisplay: org.brandDisplay,
      brandLogoShape: org.brandLogoShape,
      brandLogoScale: org.brandLogoScale,
    },
    after: { brandDisplay, brandLogoShape, brandLogoScale, brandName: brandName || null, brandColor: brandColor || null, assistantName: assistantName || null, logoChanged: Boolean(newLogo), logoRemoved: removeLogo },
  });

  revalidatePath("/", "layout");
  return { error: null, message: "Marca guardada." };
}
