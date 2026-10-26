import { describe, expect, it } from "vitest";
import { chooseNextAssignee, slaAction } from "./lead-assignment";

const c = (userId: string, openCount = 0) => ({ userId, openCount });

describe("chooseNextAssignee", () => {
  const team = [c("a"), c("b"), c("c")];

  it("sin nadie disponible no asigna", () => {
    expect(chooseNextAssignee([], null, null)).toBeNull();
  });
  it("el primero de la lista cuando todavía no hubo reparto", () => {
    expect(chooseNextAssignee(team, null, null)).toBe("a");
  });
  it("reparte por turnos y vuelve al principio", () => {
    expect(chooseNextAssignee(team, "a", null)).toBe("b");
    expect(chooseNextAssignee(team, "b", null)).toBe("c");
    expect(chooseNextAssignee(team, "c", null)).toBe("a");
  });
  it("si el último ya no está en el equipo, empieza desde el principio", () => {
    expect(chooseNextAssignee(team, "zzz", null)).toBe("a");
  });
  it("un reparto largo es parejo", () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    let last: string | null = null;
    for (let i = 0; i < 30; i++) {
      last = chooseNextAssignee(team, last, null)!;
      counts[last]++;
    }
    expect(counts).toEqual({ a: 10, b: 10, c: 10 });
  });
  it("saltea a quien llegó al tope de leads abiertos", () => {
    expect(chooseNextAssignee([c("a", 5), c("b", 1), c("c", 5)], null, 5)).toBe("b");
  });
  it("si todos están en el tope, no asigna", () => {
    expect(chooseNextAssignee([c("a", 5), c("b", 5)], null, 5)).toBeNull();
  });
  it("sin tope no limita", () => {
    expect(chooseNextAssignee([c("a", 999)], null, null)).toBe("a");
  });
  it("al reasignar no vuelve a quien no respondió", () => {
    expect(chooseNextAssignee(team, "a", null, ["b"])).toBe("c");
    expect(chooseNextAssignee([c("a")], null, null, ["a"])).toBeNull();
  });
});

describe("slaAction", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const base = { now, slaMinutes: 15, alertedAt: null, reassignedAt: null, autoAssigned: true };
  const waiting = (min: number) => new Date(now.getTime() - min * 60_000);

  it("antes del plazo no hace nada", () => {
    expect(slaAction({ ...base, waitingSince: waiting(10) })).toBe("none");
  });
  it("al cumplirse el plazo avisa", () => {
    expect(slaAction({ ...base, waitingSince: waiting(15) })).toBe("alert");
  });
  it("no repite el aviso de la misma espera", () => {
    expect(slaAction({ ...base, waitingSince: waiting(20), alertedAt: waiting(5) })).toBe("none");
  });
  it("avisa otra vez si es una espera nueva", () => {
    expect(slaAction({ ...base, waitingSince: waiting(16), alertedAt: waiting(60) })).toBe("alert");
  });
  it("al doble del plazo reasigna si lo asignó el sistema", () => {
    expect(slaAction({ ...base, waitingSince: waiting(30), alertedAt: waiting(15) })).toBe("reassign");
  });
  it("lo asignado a mano nunca se reasigna solo, solo avisa", () => {
    expect(slaAction({ ...base, autoAssigned: false, waitingSince: waiting(45) })).toBe("alert");
  });
  it("solo se reasigna una vez por lead", () => {
    expect(slaAction({ ...base, waitingSince: waiting(45), alertedAt: waiting(15), reassignedAt: waiting(10) })).toBe("none");
  });
});
