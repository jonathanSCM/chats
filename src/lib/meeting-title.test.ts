import { describe, expect, it } from "vitest";
import { meetingTitleForClient } from "./meeting-title";

describe("meetingTitleForClient", () => {
  it("usa lo que escribió el vendedor", () => {
    expect(meetingTitleForClient({ title: "  Diagnóstico comercial  ", contactName: "Ana" })).toBe("Diagnóstico comercial");
  });

  it("sin título, 'Reunión con {nombre}'", () => {
    expect(meetingTitleForClient({ contactName: "Ana Pérez" })).toBe("Reunión con Ana Pérez");
    expect(meetingTitleForClient({ title: "   ", contactName: "Ana Pérez" })).toBe("Reunión con Ana Pérez");
  });

  it("sin nombre usa el teléfono, y sin nada 'cliente'", () => {
    expect(meetingTitleForClient({ contactName: null, phone: "51987654321" })).toBe("Reunión con 51987654321");
    expect(meetingTitleForClient({})).toBe("Reunión con cliente");
  });

  it("no recibe ni puede filtrar datos internos como el contexto de la oportunidad", () => {
    // la función ni siquiera tiene un parámetro para eso: el título sale solo de lo escrito o del nombre
    const t = meetingTitleForClient({ contactName: "Ana", phone: "519" });
    expect(t).toBe("Reunión con Ana");
    expect(t).not.toContain("—");
  });
});
