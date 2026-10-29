"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireSession, HttpError } from "@/server/auth/guards";
import { encrypt } from "@/lib/crypto";
import { classifyKeyError, isPlausibleOpenAiKey, lastFour, parseAiMode } from "@/lib/ai-key";
import { MODELS, openAiClientFor } from "@/server/services/ai/client";
import { audit } from "@/server/services/audit";
import type { ActionState } from "./types";

async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") {
    throw new HttpError(403, "Solo el superadmin puede hacer esto");
  }
  return session;
}

/** Vacío = sin tope (null). Acepta decimales para el gasto; los tokens van como entero. */
function parseLimit(raw: FormDataEntryValue | null, opts: { integer: boolean; max: number; label: string }): { value: number | null } | { error: string } {
  const text = typeof raw === "string" ? raw.trim().replace(",", ".") : "";
  if (text === "") return { value: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return { error: `${opts.label}: debe ser un número igual o mayor que 0.` };
  if (opts.integer && !Number.isInteger(n)) return { error: `${opts.label}: debe ser un número entero.` };
  if (n > opts.max) return { error: `${opts.label}: número demasiado grande.` };
  return { value: n };
}

/**
 * Cómo usa la IA una organización. Solo el superadmin:
 *  - plataforma: la clave de la plataforma (con su tope diario de siempre);
 *  - personalizada: una clave que el superadmin le pone, con tope de gasto y/o de tokens por mes;
 *  - propia: la organización guarda su clave y paga ella (no lleva tope de la plataforma).
 * La clave personalizada se prueba con OpenAI antes de guardarse y queda cifrada.
 */
export async function updateOrgAiAction(orgId: string, _prevState: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSuperadmin();

  const mode = parseAiMode(formData.get("aiMode"));
  const budget = parseLimit(formData.get("aiMonthlyBudgetUsd"), { integer: false, max: 1_000_000, label: "Límite de gasto" });
  if ("error" in budget) return { error: budget.error };
  const tokens = parseLimit(formData.get("aiMonthlyTokenLimit"), { integer: true, max: 2_000_000_000, label: "Límite de tokens" });
  if ("error" in tokens) return { error: tokens.error };

  const before = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      aiMode: true,
      customKeyEnc: true,
      customKeyLast4: true,
      aiMonthlyBudgetUsd: true,
      aiMonthlyTokenLimit: true,
    },
  });
  if (!before) return { error: "Organización no encontrada." };

  const newKey = String(formData.get("customKey") ?? "").trim();
  let customKeyEnc = before.customKeyEnc;
  let customKeyLast4 = before.customKeyLast4;

  if (newKey) {
    if (!isPlausibleOpenAiKey(newKey)) return { error: "Esa clave no tiene el formato de OpenAI (empieza con sk-)." };
    try {
      await openAiClientFor(newKey).responses.create({ model: MODELS.fast(), input: "ok", max_output_tokens: 16 });
    } catch (error) {
      const failure = classifyKeyError(error);
      return {
        error: failure.definitive
          ? failure.message
          : `No se pudo comprobar la clave en este momento (${failure.message}). Intenta de nuevo en unos minutos.`,
      };
    }
    customKeyEnc = encrypt(newKey);
    customKeyLast4 = lastFour(newKey);
  }

  if (mode === "custom" && !customKeyEnc) {
    return { error: "Para usar una clave personalizada hay que pegar la clave de OpenAI de esta organización." };
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      aiMode: mode,
      // Se mantiene la columna anterior para que una versión vieja de la app siga entendiendo el modo "propia".
      aiOwnKeyEnabled: mode === "own",
      customKeyEnc,
      customKeyLast4,
      aiMonthlyBudgetUsd: budget.value,
      aiMonthlyTokenLimit: tokens.value,
      // Un cambio de modo o de clave deja atrás cualquier aviso viejo de la clave anterior.
      ...(newKey || mode !== before.aiMode ? { aiKeyAlertAt: null, aiKeyAlertMessage: null } : {}),
    },
  });

  await audit({
    entityType: "Organization",
    entityId: orgId,
    action: "ai_mode_updated",
    userId: session.user.id,
    organizationId: orgId,
    before: {
      aiMode: before.aiMode,
      customKeyLast4: before.customKeyLast4,
      aiMonthlyBudgetUsd: before.aiMonthlyBudgetUsd,
      aiMonthlyTokenLimit: before.aiMonthlyTokenLimit,
    },
    after: {
      aiMode: mode,
      customKeyLast4,
      aiMonthlyBudgetUsd: budget.value,
      aiMonthlyTokenLimit: tokens.value,
      keyReplaced: Boolean(newKey),
    },
  });

  revalidatePath(`/admin/organizations/${orgId}`);
  revalidatePath("/", "layout");
  return { error: null, message: "IA guardada." };
}
