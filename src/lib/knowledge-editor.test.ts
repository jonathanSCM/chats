import { describe, expect, it } from "vitest";
import {
  MAX_CHANGES,
  diffLines,
  proposedChangeSchema,
  validateChanges,
  type AiChange,
  type ItemSnapshot,
} from "./knowledge-editor";

const items: ItemSnapshot[] = [
  { id: "a", category: "QUALIFICATION", title: "Guía", content: "1. Nombre\n2. Empresa\n3. Presupuesto", active: true, version: 3 },
  { id: "b", category: "FAQ", title: "Horarios", content: "Lunes a viernes", active: false, version: 1 },
];

const change = (over: Partial<AiChange>): AiChange => ({
  action: "update",
  itemId: "a",
  category: null,
  title: null,
  content: null,
  reason: "porque sí",
  ...over,
});

describe("validateChanges", () => {
  it("acepta una edición y guarda el estado anterior y la versión base", () => {
    const { changes } = validateChanges([change({ content: "1. Nombre\n2. Empresa" })], items);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ action: "update", itemId: "a", baseVersion: 3 });
    expect(changes[0].before?.content).toContain("Presupuesto");
    expect(changes[0].title).toBe("Guía"); // conserva lo que no se pidió cambiar
  });

  it("descarta entradas inexistentes, sin cambios y duplicadas", () => {
    const { changes, dropped } = validateChanges(
      [
        change({ itemId: "zzz", content: "x1" }),
        change({ content: "1. Nombre\n2. Empresa\n3. Presupuesto" }), // idéntico
        change({ content: "otro texto" }),
        change({ content: "otro texto más" }), // segunda edición de la misma entrada
      ],
      items,
    );
    expect(changes).toHaveLength(1);
    expect(dropped.length).toBe(3);
  });

  it("crea entradas solo con categoría, título y contenido válidos", () => {
    const ok = validateChanges(
      [change({ action: "create", itemId: null, category: "POLICY", title: "Garantía", content: "30 días" })],
      items,
    );
    expect(ok.changes[0]).toMatchObject({ action: "create", itemId: null, baseVersion: null });

    const bad = validateChanges([change({ action: "create", itemId: null, category: null, title: "x", content: "" })], items);
    expect(bad.changes).toHaveLength(0);
  });

  it("desactivar/activar solo si cambia el estado", () => {
    const r = validateChanges(
      [change({ action: "deactivate", itemId: "b" }), change({ action: "activate", itemId: "b" })],
      items,
    );
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].action).toBe("activate");
  });

  it("limita la cantidad de cambios por pedido", () => {
    const many: ItemSnapshot[] = Array.from({ length: 10 }, (_, i) => ({
      id: `i${i}`, category: "FAQ", title: `T${i}`, content: `c${i}`, active: true, version: 1,
    }));
    const raw = many.map((it) => change({ itemId: it.id, content: `${it.content} nuevo` }));
    expect(validateChanges(raw, many).changes).toHaveLength(MAX_CHANGES);
  });
});

describe("proposedChangeSchema", () => {
  it("rechaza contenido vacío o demasiado largo", () => {
    const base = { action: "update", itemId: "a", category: "FAQ", title: "T1", content: "ok", reason: "", baseVersion: 1 };
    expect(proposedChangeSchema.safeParse(base).success).toBe(true);
    expect(proposedChangeSchema.safeParse({ ...base, content: "" }).success).toBe(false);
    expect(proposedChangeSchema.safeParse({ ...base, content: "x".repeat(20_001) }).success).toBe(false);
  });
});

describe("diffLines", () => {
  it("marca líneas quitadas y agregadas", () => {
    const d = diffLines("1. Nombre\n2. Empresa\n3. Presupuesto", "1. Nombre\n3. Presupuesto\n4. Cargo");
    expect(d.filter((x) => x.type === "del").map((x) => x.text)).toEqual(["2. Empresa"]);
    expect(d.filter((x) => x.type === "add").map((x) => x.text)).toEqual(["4. Cargo"]);
    expect(d.filter((x) => x.type === "same").map((x) => x.text)).toEqual(["1. Nombre", "3. Presupuesto"]);
  });

  it("textos iguales no tienen cambios", () => {
    expect(diffLines("a\nb", "a\nb").every((x) => x.type === "same")).toBe(true);
  });
});
