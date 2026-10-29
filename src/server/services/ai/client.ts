import OpenAI from "openai";
import { prisma } from "@/server/db/client";
import { decrypt } from "@/lib/crypto";
import { chooseKey, classifyKeyError, parseAiMode, type AiMode } from "@/lib/ai-key";
import { checkMonthlyLimit, monthStartUtc, type MonthlyLimits } from "@/lib/ai-limit";

// Un cliente por clave (la de la plataforma y las propias de cada organización).
const clients = new Map<string, OpenAI>();

function getClient(apiKey: string | undefined): OpenAI {
  const key = apiKey ?? "";
  let c = clients.get(key);
  if (!c) {
    c = new OpenAI({ apiKey: key });
    clients.set(key, c);
  }
  return c;
}

/** Cliente de OpenAI con una clave dada (para comprobar una clave nueva antes de guardarla). */
export function openAiClientFor(apiKey: string): OpenAI {
  return getClient(apiKey);
}

/**
 * La clave propia de la organización falló o tiene un aviso activo: la IA de esa organización se
 * detiene hasta que el dueño la corrija. A propósito NO se cae a la clave de la plataforma, para
 * no gastar el saldo de la plataforma sin querer. Hereda de AiBudgetExceededError para que los
 * procesos (bot, seguimiento) la traten igual que "sin presupuesto": se omite sin llenar la cola
 * de reintentos.
 */

interface ResolvedKey {
  apiKey: string | undefined;
  /** Organización dueña de la clave en uso (para avisarle si falla); null = la de la plataforma. */
  ownerOrgId: string | null;
  /** Qué modo se está usando; null = la clave de la plataforma. */
  mode: Exclude<AiMode, "platform"> | null;
  /** Solo en modo "custom": los topes mensuales de la organización dueña de la clave. */
  limits: MonthlyLimits | null;
}

const KEY_FIELDS = {
  id: true,
  aiMode: true,
  openaiKeyEnc: true,
  customKeyEnc: true,
  aiKeyAlertMessage: true,
  aiMonthlyBudgetUsd: true,
  aiMonthlyTokenLimit: true,
} as const;

interface KeyRow {
  id: string;
  aiMode: string;
  openaiKeyEnc: string | null;
  customKeyEnc: string | null;
  aiKeyAlertMessage: string | null;
  aiMonthlyBudgetUsd: number | null;
  aiMonthlyTokenLimit: number | null;
}

function holderOf(o: KeyRow) {
  const mode = parseAiMode(o.aiMode);
  return {
    mode,
    hasKey: mode === "own" ? Boolean(o.openaiKeyEnc) : mode === "custom" ? Boolean(o.customKeyEnc) : false,
    alertMessage: o.aiKeyAlertMessage,
  };
}

/** Qué clave de OpenAI corresponde a esta organización (la propia, la personalizada, la de su padre o la de la plataforma). */
async function resolveKey(organizationId: string): Promise<ResolvedKey> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { ...KEY_FIELDS, parent: { select: KEY_FIELDS } },
  });
  const platform: ResolvedKey = { apiKey: process.env.OPENAI_API_KEY, ownerOrgId: null, mode: null, limits: null };
  if (!org) return platform;

  const choice = chooseKey(holderOf(org), org.parent ? holderOf(org.parent) : null);
  if (choice.source === "platform") return platform;

  if (choice.source === "blocked") {
    throw new AiOwnKeyError(`La IA está detenida: ${choice.message}`);
  }
  const owner = choice.holder === "self" ? org : org.parent!;
  const enc = choice.source === "custom" ? owner.customKeyEnc : owner.openaiKeyEnc;
  return {
    apiKey: decrypt(enc!),
    ownerOrgId: owner.id,
    mode: choice.source,
    limits:
      choice.source === "custom" ? { budgetUsd: owner.aiMonthlyBudgetUsd, tokens: owner.aiMonthlyTokenLimit } : null,
  };
}

/** Gasto estimado y tokens del mes en curso de una organización y todas sus suborganizaciones (comparten la clave del padre). */
export async function getMonthUsage(rootOrgId: string, now = new Date()): Promise<{ costUsd: number; tokens: number }> {
  const children = await prisma.organization.findMany({ where: { parentId: rootOrgId }, select: { id: true } });
  const result = await prisma.aiAnalysis.aggregate({
    where: { organizationId: { in: [rootOrgId, ...children.map((c) => c.id)] }, createdAt: { gte: monthStartUtc(now) } },
    _sum: { costEstimate: true, inputTokens: true, outputTokens: true },
  });
  return {
    costUsd: Number(result._sum.costEstimate ?? 0),
    tokens: (result._sum.inputTokens ?? 0) + (result._sum.outputTokens ?? 0),
  };
}

/** Falla de una clave propia: si es definitiva (inválida, revocada, sin saldo) se deja el aviso para el dueño. */
async function recordOwnKeyFailure(ownerOrgId: string, error: unknown): Promise<void> {
  const failure = classifyKeyError(error);
  if (!failure.definitive) return;
  try {
    await prisma.organization.update({
      where: { id: ownerOrgId },
      data: { aiKeyAlertAt: new Date(), aiKeyAlertMessage: failure.message },
    });
  } catch (updateError) {
    console.error("[ai] No se pudo guardar el aviso de la clave propia:", updateError);
  }
}

export function isAiEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.AI_ENABLED !== "false";
}

/**
 * Modelos configurables por entorno, nunca escritos en el código: los
 * nombres y precios cambian seguido (manual §20).
 */
export const MODELS = {
  fast: () => process.env.OPENAI_MODEL_FAST || "gpt-4.1-mini",
  analysis: () => process.env.OPENAI_MODEL_ANALYSIS || "gpt-4.1-mini",
  executive: () => process.env.OPENAI_MODEL_EXECUTIVE || "gpt-4.1",
};

/**
 * Precio por millón de tokens, configurable porque cambia con el tiempo.
 * Solo sirve para estimar el gasto y cortar a tiempo, no para facturar.
 */
function pricePerMillion(): { input: number; output: number; cachedInput: number } {
  const input = Number(process.env.OPENAI_PRICE_INPUT_PER_M ?? 0.4);
  return {
    input,
    output: Number(process.env.OPENAI_PRICE_OUTPUT_PER_M ?? 1.6),
    // OpenAI cobra los tokens de entrada que pega contra el cache automático
    // a un precio reducido (no gratis). Sin variable propia, asumimos la
    // mitad del precio de entrada normal — ajustable si el precio real
    // publicado difiere.
    cachedInput: Number(process.env.OPENAI_PRICE_CACHED_INPUT_PER_M ?? input / 2),
  };
}

/**
 * `cachedTokens` ya viene incluido en `inputTokens` (así lo reporta la API) —
 * se descuenta la porción cacheada al precio reducido en vez de cobrarla toda
 * al precio full.
 */
export function estimateCost(inputTokens: number, outputTokens: number, cachedTokens = 0): number {
  const price = pricePerMillion();
  const freshInputTokens = Math.max(0, inputTokens - cachedTokens);
  return (
    (freshInputTokens * price.input + cachedTokens * price.cachedInput + outputTokens * price.output) / 1_000_000
  );
}

/** Tope de gasto diario en USD; al superarlo se deja de analizar (manual §34). */
function dailyBudget(): number {
  return Number(process.env.AI_DAILY_BUDGET_USD ?? 2);
}

export async function spentToday(organizationId: string): Promise<number> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const result = await prisma.aiAnalysis.aggregate({
    where: { organizationId, createdAt: { gte: since } },
    _sum: { costEstimate: true },
  });

  return Number(result._sum.costEstimate ?? 0);
}

export async function isWithinBudget(organizationId: string): Promise<boolean> {
  return (await spentToday(organizationId)) < dailyBudget();
}

export class AiBudgetExceededError extends Error {
  constructor(message = "Se alcanzó el tope de gasto diario de IA") {
    super(message);
    this.name = "AiBudgetExceededError";
  }
}

/** Ver la nota de uso en `resolveKey`: es la falla de la clave propia de la organización. */
export class AiOwnKeyError extends AiBudgetExceededError {
  constructor(message: string) {
    super(message);
    this.name = "AiOwnKeyError";
  }
}

/** Se llegó al tope mensual de IA (gasto o tokens) de una organización con clave personalizada. */
export class AiMonthlyLimitError extends AiBudgetExceededError {
  constructor(message: string) {
    super(message);
    this.name = "AiMonthlyLimitError";
  }
}

/**
 * Distingue "sin créditos" de cualquier otro fallo (red, esquema inválido,
 * rate limit pasajero) -- solo lo primero amerita un aviso en /admin,
 * porque no se arregla solo con un reintento. OpenAI manda 429 tanto para
 * rate limit como para sin-créditos; lo que los distingue es el
 * type/code del error, no el status HTTP.
 */
function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { status?: number; code?: string; type?: string; message?: string; error?: { type?: string; code?: string } };
  const code = err.code ?? err.error?.code;
  const type = err.type ?? err.error?.type;
  if (code === "insufficient_quota" || code === "credit_balance_exhausted") return true;
  if (type === "insufficient_quota") return true;
  return Boolean(err.message?.toLowerCase().includes("credit"));
}

/**
 * Se llama solo desde runStructured() -- guarda (o limpia) el aviso de
 * "sin créditos" en la fila singleton de PlatformSetting, para que
 * /admin lo muestre sin tener que ir a buscar en los logs del servidor.
 * Best-effort: si esto falla, no debe tumbar la llamada a la IA en sí.
 */
async function updateQuotaAlert(error: unknown): Promise<void> {
  try {
    if (isQuotaError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.platformSetting.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", aiQuotaAlertAt: new Date(), aiQuotaAlertMessage: message },
        update: { aiQuotaAlertAt: new Date(), aiQuotaAlertMessage: message },
      });
    } else {
      // Una llamada que sí llegó a intentar el request (falló por otra razón,
      // o directamente funcionó) confirma que las credenciales están bien --
      // se limpia cualquier aviso viejo.
      await prisma.platformSetting.updateMany({
        where: { id: "singleton", aiQuotaAlertAt: { not: null } },
        data: { aiQuotaAlertAt: null, aiQuotaAlertMessage: null },
      });
    }
  } catch (updateError) {
    console.error("[ai] No se pudo actualizar el aviso de créditos de OpenAI:", updateError);
  }
}

export interface RunOptions<T> {
  organizationId: string;
  entityType: string;
  entityId: string;
  analysisType: string;
  promptVersion: string;
  model: string;
  system: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  parse: (raw: unknown) => T;
}

/**
 * Llama al modelo pidiendo JSON con esquema estricto, valida el resultado y
 * deja registrado el consumo.
 *
 * El manual (§22) es explícito: nada de texto libre para actualizar el CRM.
 * Si el JSON no valida se reintenta una vez; si vuelve a fallar se guarda
 * como no procesado en vez de escribir datos dudosos (§36).
 */
export async function runStructured<T>(options: RunOptions<T>): Promise<T> {
  const key = await resolveKey(options.organizationId);
  if (!key.apiKey || process.env.AI_ENABLED === "false") {
    throw new Error("La IA no está configurada (falta OPENAI_API_KEY)");
  }

  // El tope diario protege el saldo de la plataforma: con la clave propia el gasto es del cliente.
  if (key.ownerOrgId === null && !(await isWithinBudget(options.organizationId))) {
    throw new AiBudgetExceededError();
  }

  // Clave personalizada: tope de gasto y/o tokens por mes (de toda la organización y sus hijas).
  if (key.mode === "custom" && key.limits && key.ownerOrgId) {
    const status = checkMonthlyLimit(key.limits, await getMonthUsage(key.ownerOrgId));
    if (!status.ok) throw new AiMonthlyLimitError(status.message);
  }

  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let lastError: unknown = null;

  // Un solo reintento: si el modelo devuelve algo que no valida dos veces,
  // insistir solo quema presupuesto.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await getClient(key.apiKey).responses.create({
        model: options.model,
        instructions: options.system,
        input:
          attempt === 1
            ? options.input
            : `${options.input}\n\nTu respuesta anterior no cumplió el esquema. Devuelve exclusivamente el JSON pedido.`,
        text: {
          format: {
            type: "json_schema",
            name: options.schemaName,
            schema: options.schema,
            strict: true,
          },
        },
      });

      inputTokens += response.usage?.input_tokens ?? 0;
      outputTokens += response.usage?.output_tokens ?? 0;
      cachedTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;

      const parsed = options.parse(JSON.parse(response.output_text));

      await prisma.aiAnalysis.create({
        data: {
          organizationId: options.organizationId,
          entityType: options.entityType,
          entityId: options.entityId,
          analysisType: options.analysisType,
          model: options.model,
          promptVersion: options.promptVersion,
          inputTokens,
          outputTokens,
          cachedTokens,
          costEstimate: estimateCost(inputTokens, outputTokens, cachedTokens),
          result: parsed as never,
          durationMs: Date.now() - startedAt,
        },
      });

      if (key.ownerOrgId === null) {
        await updateQuotaAlert(null);
      } else {
        // Una llamada que funcionó confirma que la clave está bien: se limpia cualquier aviso viejo.
        await prisma.organization.updateMany({
          where: { id: key.ownerOrgId, aiKeyAlertAt: { not: null } },
          data: { aiKeyAlertAt: null, aiKeyAlertMessage: null },
        });
      }
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }

  await prisma.aiAnalysis.create({
    data: {
      organizationId: options.organizationId,
      entityType: options.entityType,
      entityId: options.entityId,
      analysisType: options.analysisType,
      model: options.model,
      promptVersion: options.promptVersion,
      inputTokens,
      outputTokens,
      cachedTokens,
      costEstimate: estimateCost(inputTokens, outputTokens, cachedTokens),
      error: lastError instanceof Error ? lastError.message : String(lastError),
      durationMs: Date.now() - startedAt,
    },
  });

  if (key.ownerOrgId === null) {
    await updateQuotaAlert(lastError);
  } else {
    await recordOwnKeyFailure(key.ownerOrgId, lastError);
  }
  throw lastError;
}
