import { describe, expect, it } from "vitest";
import { aggregateObjections, firstResponseMinutes, median, objectionKey, stageDwellDays } from "./learning";

const d = (s: string) => new Date(s);

describe("learning", () => {
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("agrupa objeciones parecidas y las cuenta una vez por oportunidad", () => {
    expect(objectionKey("Es muy CARO.")).toBe(objectionKey("es muy caro"));
    const r = aggregateObjections([
      { texts: ["Es muy caro", "es muy caro."], outcome: "lost" },
      { texts: ["Es muy caro", "Necesita consultar al socio"], outcome: "won" },
    ]);
    expect(r[0]).toMatchObject({ count: 2, won: 1, lost: 1 });
    expect(r).toHaveLength(2);
  });

  it("mide permanencia por etapa y cuenta la actual solo si está abierta", () => {
    const events = [
      { opportunityId: "a", stageId: "s1", at: d("2026-10-01T00:00:00Z") },
      { opportunityId: "a", stageId: "s2", at: d("2026-10-03T00:00:00Z") },
      { opportunityId: "b", stageId: "s1", at: d("2026-10-01T00:00:00Z") },
    ];
    const open = stageDwellDays(events, new Set(["a"]), d("2026-10-06T00:00:00Z"));
    expect(open.get("s1")).toEqual([2]);
    expect(open.get("s2")).toEqual([3]);
  });

  it("tiempo de primera respuesta humana", () => {
    const r = firstResponseMinutes([
      { conversationId: "c1", role: "CUSTOMER", createdAt: d("2026-10-01T10:00:00Z") },
      { conversationId: "c1", role: "BOT", createdAt: d("2026-10-01T10:01:00Z") },
      { conversationId: "c1", role: "STAFF", createdAt: d("2026-10-01T10:30:00Z") },
      { conversationId: "c2", role: "STAFF", createdAt: d("2026-10-01T11:00:00Z") },
    ]);
    expect(r).toEqual([30]);
  });
});
