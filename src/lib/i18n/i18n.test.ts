import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "./en";
import { normalizeLocale, translate } from "./index";

describe("translate", () => {
  it("devuelve la traducción si existe y el mismo texto en español si falta", () => {
    expect(translate({ Guardar: "Save" }, "Guardar")).toBe("Save");
    expect(translate({ Guardar: "Save" }, "Cancelar")).toBe("Cancelar");
    expect(translate({}, "Guardar")).toBe("Guardar");
  });

  it("reemplaza las llaves con los datos, también cuando no hay traducción", () => {
    const dict = { "Hola, {name}": "Hello, {name}" };
    expect(translate(dict, "Hola, {name}", { name: "Ana" })).toBe("Hello, Ana");
    expect(translate({}, "Hola, {name}", { name: "Ana" })).toBe("Hola, Ana");
    expect(translate(dict, "Hola, {name}", {})).toBe("Hello, {name}");
    expect(translate({ "{n} filas": "{n} rows" }, "{n} filas", { n: 3 })).toBe("3 rows");
  });
});

describe("normalizeLocale", () => {
  it("solo acepta los idiomas disponibles; cualquier otra cosa es español", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("es")).toBe("es");
    expect(normalizeLocale("fr")).toBe("es");
    expect(normalizeLocale(undefined)).toBe("es");
    expect(normalizeLocale(null)).toBe("es");
  });
});

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("diccionario en inglés", () => {
  it("ninguna traducción está vacía y las llaves {…} coinciden con las del texto en español", () => {
    for (const [es, english] of Object.entries(en)) {
      expect(english.trim(), `traducción vacía de: ${es}`).not.toBe("");
      expect(placeholders(english), `llaves distintas en: ${es}`).toEqual(placeholders(es));
    }
  });

  it("todo texto envuelto en t(\"…\") o tr(\"…\") en el código tiene su traducción", () => {
    const root = path.join(process.cwd(), "src");
    const call = /\b(?:t|tr)\(\s*"((?:[^"\\]|\\.)*)"/g;
    const missing = new Set<string>();
    for (const rel of readdirSync(root, { recursive: true }) as string[]) {
      const file = rel.replaceAll("\\", "/");
      if (!/\.tsx?$/.test(file) || file.endsWith(".test.ts") || file.startsWith("generated/") || file.startsWith("lib/i18n/")) continue;
      const source = readFileSync(path.join(root, rel), "utf8");
      for (const match of source.matchAll(call)) {
        const key = match[1].replaceAll('\\"', '"');
        if (!(key in en)) missing.add(`${file}: ${key}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
