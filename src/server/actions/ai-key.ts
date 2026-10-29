"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { encrypt } from "@/lib/crypto";
import { classifyKeyError, isPlausibleOpenAiKey, lastFour } from "@/lib/ai-key";
import { MODELS, openAiClientFor } from "@/server/services/ai/client";
import { audit } from "@/server/services/audit";
import type { ActionState } from "./types";

async function requireOwnerWithOption() {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    return { ok: false, error: "Solo el dueño de la organización puede cambiar la clave de OpenAI." } as const;
  }
  const org = await prisma.organization.findUnique({
    where: { id: session.user.organizationId },
    select: { aiOwnKeyEnabled: true, openaiKeyLast4: true },
  });
  if (!org) return { ok: false, error: "Organización no encontrada." } as const;
  if (!org.aiOwnKeyEnabled) return { ok: false, error: "Tu plan no incluye usar tu propia clave de OpenAI." } as const;
  return { ok: true, session, organizationId: session.user.organizationId, org } as const;
}

/**
 * Guarda la clave de OpenAI de la organización. Antes de aceptarla se prueba con una llamada mínima
 * (cuesta una fracción de centavo, de la cuenta del propio cliente): así se descubre al instante si
 * está mal escrita, revocada o sin saldo, en vez de enterarse cuando el bot deja de contestar.
 */
export async function saveOpenAiKeyAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await requireOwnerWithOption();
  if (!ctx.ok) return { error: ctx.error };

  const key = String(formData.get("openaiKey") ?? "").trim();
  if (!isPlausibleOpenAiKey(key)) {
    return { error: "Esa clave no tiene el formato de OpenAI (empieza con sk-)." };
  }

  try {
    await openAiClientFor(key).responses.create({ model: MODELS.fast(), input: "ok", max_output_tokens: 16 });
  } catch (error) {
    const failure = classifyKeyError(error);
    return {
      error: failure.definitive
        ? failure.message
        : `No se pudo comprobar la clave en este momento (${failure.message}). Intenta de nuevo en unos minutos.`,
    };
  }

  await prisma.organization.update({
    where: { id: ctx.organizationId },
    data: { openaiKeyEnc: encrypt(key), openaiKeyLast4: lastFour(key), aiKeyAlertAt: null, aiKeyAlertMessage: null },
  });
  await audit({
    entityType: "Organization",
    entityId: ctx.organizationId,
    action: "openai_key_saved",
    userId: ctx.session.user.id,
    organizationId: ctx.organizationId,
    before: { last4: ctx.org.openaiKeyLast4 },
    after: { last4: lastFour(key) },
  });

  revalidatePath("/", "layout");
  return { error: null, message: "Clave guardada. Desde ahora la IA de tu organización usa tu cuenta de OpenAI." };
}

/** Quita la clave propia: la organización vuelve a usar la de la plataforma. */
export async function removeOpenAiKeyAction(): Promise<ActionState> {
  const ctx = await requireOwnerWithOption();
  if (!ctx.ok) return { error: ctx.error };

  await prisma.organization.update({
    where: { id: ctx.organizationId },
    data: { openaiKeyEnc: null, openaiKeyLast4: null, aiKeyAlertAt: null, aiKeyAlertMessage: null },
  });
  await audit({
    entityType: "Organization",
    entityId: ctx.organizationId,
    action: "openai_key_removed",
    userId: ctx.session.user.id,
    organizationId: ctx.organizationId,
    before: { last4: ctx.org.openaiKeyLast4 },
  });

  revalidatePath("/", "layout");
  return { error: null, message: "Clave quitada. Se usa la clave de la plataforma." };
}
