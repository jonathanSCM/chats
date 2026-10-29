import { prisma } from "@/server/db/client";
import { chooseKey, parseAiMode } from "@/lib/ai-key";
import { checkMonthlyLimit } from "@/lib/ai-limit";
import { getMonthUsage } from "./client";

/**
 * Aviso para el dueño de una organización cuando su IA está detenida:
 *  - "key-own": falló la clave propia (la puede corregir él mismo);
 *  - "key-custom": falló la clave personalizada que le puso el administrador de la plataforma;
 *  - "limit": llegó al tope mensual de su plan.
 * null = todo bien (o usa la clave de la plataforma).
 */
export type AiNotice = { kind: "key-own" | "key-custom" | "limit"; message: string };

const FIELDS = {
  id: true,
  aiMode: true,
  openaiKeyEnc: true,
  customKeyEnc: true,
  aiKeyAlertMessage: true,
  aiMonthlyBudgetUsd: true,
  aiMonthlyTokenLimit: true,
} as const;

type Row = {
  id: string;
  aiMode: string;
  openaiKeyEnc: string | null;
  customKeyEnc: string | null;
  aiKeyAlertMessage: string | null;
  aiMonthlyBudgetUsd: number | null;
  aiMonthlyTokenLimit: number | null;
};

function holder(o: Row) {
  const mode = parseAiMode(o.aiMode);
  return {
    mode,
    hasKey: mode === "own" ? Boolean(o.openaiKeyEnc) : mode === "custom" ? Boolean(o.customKeyEnc) : false,
    alertMessage: o.aiKeyAlertMessage,
  };
}

export async function getAiNotice(organizationId: string): Promise<AiNotice | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { ...FIELDS, parent: { select: FIELDS } },
  });
  if (!org) return null;

  const choice = chooseKey(holder(org), org.parent ? holder(org.parent) : null);
  if (choice.source === "platform") return null;
  if (choice.source === "blocked") {
    return { kind: choice.kind === "own" ? "key-own" : "key-custom", message: choice.message };
  }

  if (choice.source === "custom") {
    const owner = choice.holder === "self" ? org : org.parent!;
    const status = checkMonthlyLimit(
      { budgetUsd: owner.aiMonthlyBudgetUsd, tokens: owner.aiMonthlyTokenLimit },
      await getMonthUsage(owner.id),
    );
    if (!status.ok) return { kind: "limit", message: status.message };
  }
  return null;
}
