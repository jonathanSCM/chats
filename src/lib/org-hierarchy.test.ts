import { describe, expect, it } from "vitest";
import { groupSeatCounts, needsNewSeat, pickBrandSource, seatRoleByUser } from "./org-hierarchy";

const rows = [
  { userId: "ana", role: "MEMBER" as const }, // vendedora del padre
  { userId: "ana", role: "MEMBER" as const }, // y de una hija
  { userId: "ana", role: "MEMBER" as const }, // y de otra hija
  { userId: "beto", role: "MEMBER" as const },
  { userId: "admin", role: "OWNER" as const }, // administrador del padre
  { userId: "admin", role: "OWNER" as const }, // y de las hijas (acceso automático)
  { userId: "admin", role: "OWNER" as const },
];

describe("groupSeatCounts", () => {
  it("cuenta personas distintas, no membresías", () => {
    expect(groupSeatCounts(rows)).toEqual({ admins: 1, sellers: 2 });
  });

  it("quien es administrador en una y vendedor en otra ocupa un solo lugar: el de administrador", () => {
    const mixed = [
      { userId: "x", role: "MEMBER" as const },
      { userId: "x", role: "OWNER" as const },
    ];
    expect(seatRoleByUser(mixed).get("x")).toBe("OWNER");
    expect(groupSeatCounts(mixed)).toEqual({ admins: 1, sellers: 0 });
  });

  it("grupo vacío", () => {
    expect(groupSeatCounts([])).toEqual({ admins: 0, sellers: 0 });
  });
});

describe("needsNewSeat", () => {
  it("una vendedora que ya está en el grupo no ocupa otro lugar al sumarla a una hija", () => {
    expect(needsNewSeat(rows, "ana", "MEMBER")).toBe(false);
  });

  it("alguien nuevo sí ocupa un lugar", () => {
    expect(needsNewSeat(rows, "nuevo", "MEMBER")).toBe(true);
    expect(needsNewSeat(rows, "nuevo", "OWNER")).toBe(true);
  });

  it("un administrador ya cubierto no ocupa nada más", () => {
    expect(needsNewSeat(rows, "admin", "MEMBER")).toBe(false);
    expect(needsNewSeat(rows, "admin", "OWNER")).toBe(false);
  });

  it("subir a una vendedora a administradora sí necesita un lugar de administrador", () => {
    expect(needsNewSeat(rows, "ana", "OWNER")).toBe(true);
  });
});

describe("pickBrandSource", () => {
  const brand = (custom: boolean, name: string) => ({ custom, name });
  it("la hija usa su propia marca si tiene", () => {
    expect(pickBrandSource(brand(true, "hija"), brand(true, "padre")).name).toBe("hija");
  });
  it("sin marca propia hereda la del padre", () => {
    expect(pickBrandSource(brand(false, "hija"), brand(true, "padre")).name).toBe("padre");
  });
  it("si el padre tampoco tiene, queda la propia (sin marca)", () => {
    expect(pickBrandSource(brand(false, "hija"), brand(false, "padre")).name).toBe("hija");
    expect(pickBrandSource(brand(false, "hija"), null).name).toBe("hija");
  });
});
