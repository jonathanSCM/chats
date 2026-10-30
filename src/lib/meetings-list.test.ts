import { describe, expect, it } from "vitest";
import {
  dayKeyInZone,
  dayLabelInZone,
  groupMeetings,
  meetingDisplayTitle,
  meetingsWhere,
  parseMeetingFilters,
  startOfDayInZone,
} from "./meetings-list";

const LIMA = "America/Lima";
const NOW = new Date("2026-10-29T18:00:00Z"); // 13:00 en Lima

describe("parseMeetingFilters", () => {
  it("sin nada en la URL usa los valores por defecto", () => {
    expect(parseMeetingFilters({})).toEqual({
      q: "",
      estado: "",
      asociacion: "",
      resp: "",
      desde: "",
      hasta: "",
      vista: "dia",
      cuando: "recientes",
    });
  });

  it("lee lo válido y descarta lo raro", () => {
    const f = parseMeetingFilters({ q: "  Ana ", estado: "DONE", asociacion: "sin", vista: "cliente", cuando: "todas", desde: "2026-10-01", hasta: "no-fecha" });
    expect(f).toMatchObject({ q: "Ana", estado: "DONE", asociacion: "sin", vista: "cliente", cuando: "todas", desde: "2026-10-01", hasta: "" });
    expect(parseMeetingFilters({ estado: "HACKEADO", asociacion: "x", vista: "y", cuando: "z" })).toMatchObject({
      estado: "",
      asociacion: "",
      vista: "dia",
      cuando: "recientes",
    });
  });

  it("acepta valores repetidos tomando el primero y acota el texto de búsqueda", () => {
    expect(parseMeetingFilters({ estado: ["DONE", "SCHEDULED"] }).estado).toBe("DONE");
    expect(parseMeetingFilters({ q: "x".repeat(500) }).q).toHaveLength(80);
  });
});

describe("startOfDayInZone", () => {
  it("el inicio del día en Lima es 05:00 UTC", () => {
    expect(startOfDayInZone("2026-10-29", LIMA).toISOString()).toBe("2026-10-29T05:00:00.000Z");
  });
  it("en UTC coincide con la medianoche UTC", () => {
    expect(startOfDayInZone("2026-10-29", "UTC").toISOString()).toBe("2026-10-29T00:00:00.000Z");
  });
});

describe("meetingsWhere", () => {
  const base = parseMeetingFilters({});

  it("siempre limita a la organización y oculta los seguimientos archivados", () => {
    const w = meetingsWhere(base, "org1", NOW, LIMA);
    expect(w.organizationId).toBe("org1");
    expect(JSON.stringify(w.AND)).toContain("archivedAt");
  });

  it("por defecto muestra desde hace 7 días en adelante", () => {
    const w = meetingsWhere(base, "org1", NOW, LIMA);
    const sched = (w.AND as { scheduledAt?: { gte?: Date } }[]).find((c) => c.scheduledAt)?.scheduledAt;
    expect(sched?.gte?.toISOString()).toBe("2026-10-22T18:00:00.000Z");
  });

  it("'próximas' y 'pasadas' parten de ahora", () => {
    const get = (cuando: string) =>
      (meetingsWhere(parseMeetingFilters({ cuando }), "o", NOW, LIMA).AND as { scheduledAt?: { gte?: Date; lt?: Date } }[]).find((c) => c.scheduledAt)?.scheduledAt;
    expect(get("proximas")?.gte?.toISOString()).toBe(NOW.toISOString());
    expect(get("pasadas")?.lt?.toISOString()).toBe(NOW.toISOString());
    expect(get("todas")).toBeUndefined();
  });

  it("desde y hasta se interpretan en la zona de la organización y 'hasta' incluye todo ese día", () => {
    const w = meetingsWhere(parseMeetingFilters({ cuando: "todas", desde: "2026-10-10", hasta: "2026-10-12" }), "o", NOW, LIMA);
    const sched = (w.AND as { scheduledAt?: { gte?: Date; lt?: Date } }[]).find((c) => c.scheduledAt)?.scheduledAt;
    expect(sched?.gte?.toISOString()).toBe("2026-10-10T05:00:00.000Z");
    expect(sched?.lt?.toISOString()).toBe("2026-10-13T05:00:00.000Z");
  });

  it("estado, asociación, responsable y búsqueda se suman", () => {
    const f = parseMeetingFilters({ estado: "DONE", asociacion: "con", resp: "u1", q: "ana", cuando: "todas" });
    const s = JSON.stringify(meetingsWhere(f, "o", NOW, LIMA).AND);
    expect(s).toContain('"status":"DONE"');
    expect(s).toContain('"opportunityId":{"not":null}');
    expect(s).toContain('"assignedToId":"u1"');
    expect(s).toContain('"contains":"ana"');
  });
});

describe("días en la zona horaria de la organización", () => {
  it("una reunión de las 20:00 en Lima cae en ese día, no en el siguiente (UTC)", () => {
    expect(dayKeyInZone("2026-10-30T01:00:00Z", LIMA)).toBe("2026-10-29");
    expect(dayKeyInZone("2026-10-30T01:00:00Z", "UTC")).toBe("2026-10-30");
  });

  it("etiquetas Hoy / Mañana / Ayer y fecha larga", () => {
    expect(dayLabelInZone("2026-10-29", NOW, LIMA)).toBe("Hoy");
    expect(dayLabelInZone("2026-10-30", NOW, LIMA)).toBe("Mañana");
    expect(dayLabelInZone("2026-10-28", NOW, LIMA)).toBe("Ayer");
    expect(dayLabelInZone("2026-11-05", NOW, LIMA)).toMatch(/^Jueves/);
  });
});

const row = (id: string, iso: string, client: string | null = null) => ({
  id,
  scheduledAt: iso,
  clientKey: client ? `c-${client}` : null,
  clientName: client,
});

describe("groupMeetings", () => {
  const rows = [
    row("a", "2026-10-27T15:00:00Z", "Ana"),
    row("b", "2026-10-30T15:00:00Z", "Beto"),
    row("c", "2026-10-30T14:00:00Z"),
    row("d", "2026-10-31T15:00:00Z", "Ana"),
    row("e", "2026-10-28T15:00:00Z"),
  ];

  it("por día: primero las próximas (la más cercana arriba) y luego las pasadas (la más reciente primero)", () => {
    const g = groupMeetings(rows, "dia", NOW, LIMA);
    expect(g.map((x) => x.key)).toEqual(["2026-10-30", "2026-10-31", "2026-10-28", "2026-10-27"]);
    expect(g[0].label).toBe("Mañana");
  });

  it("por día: dentro del día, por hora", () => {
    const g = groupMeetings(rows, "dia", NOW, LIMA);
    expect(g[0].rows.map((r) => r.id)).toEqual(["c", "b"]);
  });

  it("por cliente: agrupa las de un mismo cliente, las más recientes primero, y 'Internas' al final", () => {
    const g = groupMeetings(rows, "cliente", NOW, LIMA);
    expect(g.map((x) => x.label)).toEqual(["Ana", "Beto", "Internas (sin cliente)"]);
    expect(g[0].rows.map((r) => r.id)).toEqual(["d", "a"]);
    expect(g[2].rows.map((r) => r.id)).toEqual(["c", "e"]);
  });

  it("sin reuniones, sin grupos", () => {
    expect(groupMeetings([], "dia", NOW, LIMA)).toEqual([]);
    expect(groupMeetings([], "cliente", NOW, LIMA)).toEqual([]);
  });
});

describe("meetingDisplayTitle", () => {
  it("usa el título escrito, o 'Reunión con {cliente}', o 'Reunión interna'", () => {
    expect(meetingDisplayTitle({ title: " Diagnóstico ", clientName: "Ana" })).toBe("Diagnóstico");
    expect(meetingDisplayTitle({ title: null, clientName: "Ana" })).toBe("Reunión con Ana");
    expect(meetingDisplayTitle({ title: "", clientName: null })).toBe("Reunión interna");
  });
});
