import { z } from "zod";

// Lógica pura (sin base de datos ni IA) del editor de conocimiento por chat:
// la usan el servidor (validar lo que propone el modelo y lo que se aprueba)
// y la interfaz (mostrar las diferencias).

export const KNOWLEDGE_CATEGORIES = [
  "SERVICE",
  "PRICING",
  "SCOPE",
  "EXCLUSION",
  "FAQ",
  "POLICY",
  "CASE_STUDY",
  "QUALIFICATION",
  "TONE",
] as const;
export type KnowledgeCategoryKey = (typeof KNOWLEDGE_CATEGORIES)[number];

export const MAX_CHANGES = 5;
export const TITLE_MAX = 160;
export const CONTENT_MAX = 20_000;
/** Si la base completa supera esto, el editor no puede mandarla al modelo sin recortar. */
export const MAX_PROMPT_CHARS = 150_000;

export const CHANGE_ACTIONS = ["update", "create", "deactivate", "activate"] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

/** Forma que devuelve el modelo (esquema estricto). */
export const aiChangeSchema = z.object({
  action: z.enum(CHANGE_ACTIONS),
  itemId: z.string().nullable(),
  category: z.enum(KNOWLEDGE_CATEGORIES).nullable(),
  title: z.string().nullable(),
  content: z.string().nullable(),
  reason: z.string(),
});
export const aiProposalSchema = z.object({
  message: z.string(),
  needsClarification: z.string().nullable(),
  changes: z.array(aiChangeSchema),
});
export type AiChange = z.infer<typeof aiChangeSchema>;
export type AiProposal = z.infer<typeof aiProposalSchema>;

export interface ItemSnapshot {
  id: string;
  category: KnowledgeCategoryKey;
  title: string;
  content: string;
  active: boolean;
  version: number;
}

/** Cambio ya validado, listo para mostrar y, si se aprueba, aplicar. */
export const proposedChangeSchema = z.object({
  action: z.enum(CHANGE_ACTIONS),
  itemId: z.string().nullable(),
  category: z.enum(KNOWLEDGE_CATEGORIES),
  title: z.string().min(2).max(TITLE_MAX),
  content: z.string().min(2).max(CONTENT_MAX),
  reason: z.string().max(600),
  /** Versión de la entrada cuando se propuso: si cambió, el cambio ya no es seguro. */
  baseVersion: z.number().int().nullable(),
});
export type ProposedChange = z.infer<typeof proposedChangeSchema> & {
  before: { category: KnowledgeCategoryKey; title: string; content: string; active: boolean } | null;
};

const clean = (s: string | null | undefined) => (s ?? "").trim();

/**
 * Valida lo que propuso el modelo contra la base real. Descarta lo que no se
 * puede aplicar con seguridad (entrada inexistente, sin cambios, fuera de
 * límites) y devuelve la lista de motivos para registrarlo.
 */
export function validateChanges(
  raw: AiChange[],
  items: ItemSnapshot[],
): { changes: ProposedChange[]; dropped: string[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const touched = new Set<string>();
  const changes: ProposedChange[] = [];
  const dropped: string[] = [];

  for (const c of raw.slice(0, MAX_CHANGES * 2)) {
    if (changes.length >= MAX_CHANGES) {
      dropped.push("Demasiados cambios en un solo pedido");
      break;
    }

    if (c.action === "create") {
      const title = clean(c.title);
      const content = clean(c.content);
      if (!c.category || title.length < 2 || content.length < 2) {
        dropped.push("Entrada nueva incompleta");
        continue;
      }
      if (title.length > TITLE_MAX || content.length > CONTENT_MAX) {
        dropped.push(`"${title.slice(0, 40)}" excede los límites`);
        continue;
      }
      changes.push({
        action: "create",
        itemId: null,
        category: c.category,
        title,
        content,
        reason: clean(c.reason).slice(0, 600),
        baseVersion: null,
        before: null,
      });
      continue;
    }

    const item = c.itemId ? byId.get(c.itemId) : undefined;
    if (!item) {
      dropped.push("Entrada inexistente");
      continue;
    }
    if (touched.has(item.id)) {
      dropped.push(`"${item.title}" ya tenía un cambio en este pedido`);
      continue;
    }
    const before = { category: item.category, title: item.title, content: item.content, active: item.active };

    if (c.action === "deactivate" || c.action === "activate") {
      const wantActive = c.action === "activate";
      if (item.active === wantActive) {
        dropped.push(`"${item.title}" ya estaba ${wantActive ? "activa" : "desactivada"}`);
        continue;
      }
      touched.add(item.id);
      changes.push({
        action: c.action,
        itemId: item.id,
        category: item.category,
        title: item.title,
        content: item.content,
        reason: clean(c.reason).slice(0, 600),
        baseVersion: item.version,
        before,
      });
      continue;
    }

    // update
    const title = clean(c.title) || item.title;
    const content = clean(c.content) || item.content;
    const category = c.category ?? item.category;
    if (title.length < 2 || title.length > TITLE_MAX || content.length < 2 || content.length > CONTENT_MAX) {
      dropped.push(`"${item.title}" excede los límites`);
      continue;
    }
    if (title === item.title && content === item.content && category === item.category) {
      dropped.push(`"${item.title}" quedaba sin cambios`);
      continue;
    }
    touched.add(item.id);
    changes.push({
      action: "update",
      itemId: item.id,
      category,
      title,
      content,
      reason: clean(c.reason).slice(0, 600),
      baseVersion: item.version,
      before,
    });
  }

  return { changes, dropped };
}

export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
}

/** Diferencia por líneas (LCS). Para textos enormes cae a "todo cambió". */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 4_000_000) {
    return [...a.map((text) => ({ type: "del" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];
  }

  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "del", text: a[i++] });
    } else {
      out.push({ type: "add", text: b[j++] });
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}
