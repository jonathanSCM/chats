import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guardia de aislamiento: toda la IA pasa por `ai/client.ts`, que elige la clave POR ORGANIZACIÓN.
 * Si alguien agrega una llamada directa a OpenAI, o lee la clave de la plataforma desde otro archivo,
 * se saltaría esa elección y una organización con clave propia podría terminar usando la de la plataforma
 * (o al revés). Este test falla en cuanto eso pase.
 */

const ROOT = join(process.cwd(), "src");
const ALLOWED = new Set([join("server", "services", "ai", "client.ts")]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "generated" || name === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(ROOT).map((path) => ({ rel: relative(ROOT, path), text: readFileSync(path, "utf8") }));

describe("aislamiento de la clave de OpenAI", () => {
  it("solo ai/client.ts importa la librería de OpenAI", () => {
    const offenders = files.filter((f) => !ALLOWED.has(f.rel) && /from\s+["']openai["']|require\(["']openai["']\)/.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it("solo ai/client.ts lee la clave de la plataforma (OPENAI_API_KEY)", () => {
    const offenders = files.filter((f) => !ALLOWED.has(f.rel) && f.text.includes("process.env.OPENAI_API_KEY"));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it("nadie llama a la API de OpenAI por HTTP a mano, saltándose el cliente", () => {
    const offenders = files.filter((f) => !ALLOWED.has(f.rel) && f.text.includes("api.openai.com"));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  it("toda llamada a runStructured declara de qué organización es", () => {
    const callers = files.filter((f) => !ALLOWED.has(f.rel) && /runStructured\s*(<[^>]*>)?\s*\(/.test(f.text));
    expect(callers.length).toBeGreaterThan(0);
    for (const f of callers) {
      // cada llamada abre un objeto de opciones que debe incluir organizationId
      const calls = [...f.text.matchAll(/runStructured\s*(?:<[^>]*>)?\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)/g)];
      expect(calls.length, `${f.rel} no tiene llamadas reconocibles`).toBeGreaterThan(0);
      for (const call of calls) expect(call[1], `${f.rel}: falta organizationId`).toMatch(/organizationId\s*:/);
    }
  });
});
