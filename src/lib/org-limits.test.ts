import { describe, expect, it } from "vitest";
import { checkSeat, formatSeatUsage } from "./org-limits";

const limits = { maxAdmins: 2, maxSellers: 3 };

describe("checkSeat", () => {
  it("deja agregar mientras haya lugar", () => {
    expect(checkSeat(limits, { admins: 1, sellers: 2 }, "MEMBER")).toEqual({ ok: true });
    expect(checkSeat(limits, { admins: 1, sellers: 2 }, "OWNER")).toEqual({ ok: true });
  });

  it("bloquea al llegar al tope, con un mensaje claro", () => {
    const r = checkSeat(limits, { admins: 0, sellers: 3 }, "MEMBER");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/3 vendedores y ya tienes 3/);
    const a = checkSeat({ maxAdmins: 1, maxSellers: null }, { admins: 1, sellers: 0 }, "OWNER");
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.message).toMatch(/1 administrador y ya tienes 1/);
  });

  it("los dos roles tienen topes independientes", () => {
    expect(checkSeat(limits, { admins: 2, sellers: 0 }, "MEMBER").ok).toBe(true);
    expect(checkSeat(limits, { admins: 0, sellers: 3 }, "OWNER").ok).toBe(true);
  });

  it("sin tope (null) siempre cabe", () => {
    expect(checkSeat({ maxAdmins: null, maxSellers: null }, { admins: 999, sellers: 999 }, "MEMBER").ok).toBe(true);
  });

  it("un tope de 0 no deja entrar a nadie de ese rol", () => {
    expect(checkSeat({ maxAdmins: null, maxSellers: 0 }, { admins: 1, sellers: 0 }, "MEMBER").ok).toBe(false);
  });
});

describe("formatSeatUsage", () => {
  it("muestra el uso", () => {
    expect(formatSeatUsage(2, 5)).toBe("2 de 5");
    expect(formatSeatUsage(2, null)).toBe("2 (sin límite)");
  });
});
