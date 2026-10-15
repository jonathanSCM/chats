import { describe, expect, it } from "vitest";
import { buildProposals, parseStepDate, type OpportunitySnapshot } from "./meeting-apply";
import type { MeetingSummaryData } from "./meeting-summary";

const meetingDate = new Date("2026-10-15T14:00:00Z");

const empty: OpportunitySnapshot = {
  needSummary: null,
  budgetRange: null,
  urgency: null,
  authorityLevel: null,
  nextAction: null,
  nextActionAt: null,
  lastUpdate: null,
};

const data: MeetingSummaryData = {
  resumen: "Marcela necesita automatizar la agenda. Tienen tres sucursales.",
  puntosClave: [],
  decisiones: [],
  proximosPasos: [{ accion: "Enviar propuesta", responsable: "Carlos", fecha: "el viernes", fechaIso: "2026-10-16" }],
  informacionComercial: {
    necesidad: "Agenda automática",
    dolor: "Pierden pacientes",
    presupuesto: "1.500 USD",
    decisor: "Doctor Ríos",
    urgencia: "Antes de fin de mes",
    objeciones: ["Resistencia del personal."],
    acuerdos: ["Propuesta el viernes"],
  },
};

describe("parseStepDate", () => {
  it("acepta fechas razonables y descarta el resto", () => {
    expect(parseStepDate("2026-10-16", meetingDate)?.toISOString().slice(0, 10)).toBe("2026-10-16");
    expect(parseStepDate("viernes", meetingDate)).toBeNull();
    expect(parseStepDate(null, meetingDate)).toBeNull();
    expect(parseStepDate("2020-01-01", meetingDate)).toBeNull();
    expect(parseStepDate("2030-01-01", meetingDate)).toBeNull();
    expect(parseStepDate("2026-13-45", meetingDate)).toBeNull();
  });
});

describe("buildProposals", () => {
  it("propone completar los campos vacíos como 'fill'", () => {
    const p = buildProposals(data, empty, meetingDate);
    const byKey = Object.fromEntries(p.map((x) => [x.key, x]));
    expect(Object.keys(byKey).sort()).toEqual(["authority", "budget", "lastUpdate", "need", "nextAction", "urgency"]);
    expect(byKey.need.mode).toBe("fill");
    expect(byKey.need.changes.needSummary).toBe("Agenda automática Dolor: Pierden pacientes");
    expect(byKey.need.changes.needStatus).toBe("CONFIRMED");
    expect(byKey.budget.changes.budgetStatus).toBe("CONFIRMED");
    expect(byKey.nextAction.changes.nextAction).toBe("Enviar propuesta");
    expect(byKey.nextAction.changes.nextActionAt?.toISOString().slice(0, 10)).toBe("2026-10-16");
    expect(byKey.lastUpdate.changes.lastUpdate).toContain("[15/10 reunión] Marcela necesita automatizar la agenda.");
    expect(byKey.lastUpdate.changes.lastUpdate).toContain("Acuerdos: Propuesta el viernes.");
  });

  it("marca 'replace' cuando ya hay un valor distinto y omite lo que ya coincide", () => {
    const current: OpportunitySnapshot = { ...empty, budgetRange: "500 USD", urgency: "Antes de fin de mes" };
    const p = buildProposals(data, current, meetingDate);
    expect(p.find((x) => x.key === "budget")?.mode).toBe("replace");
    expect(p.find((x) => x.key === "budget")?.current).toBe("500 USD");
    expect(p.find((x) => x.key === "urgency")).toBeUndefined();
  });

  it("agrega a la última actualización sin borrar lo anterior ni duplicar", () => {
    const first = buildProposals(data, { ...empty, lastUpdate: "Pidió más tiempo" }, meetingDate);
    const upd = first.find((x) => x.key === "lastUpdate");
    expect(upd?.mode).toBe("append");
    expect(upd?.changes.lastUpdate?.endsWith("Pidió más tiempo")).toBe(true);

    const again = buildProposals(data, { ...empty, lastUpdate: upd!.changes.lastUpdate! }, meetingDate);
    expect(again.find((x) => x.key === "lastUpdate")).toBeUndefined();
  });

  it("no propone nada si la reunión no tuvo datos", () => {
    const blank: MeetingSummaryData = {
      resumen: "",
      puntosClave: [],
      decisiones: [],
      proximosPasos: [],
      informacionComercial: {
        necesidad: null, dolor: null, presupuesto: null, decisor: null, urgencia: null, objeciones: [], acuerdos: [],
      },
    };
    expect(buildProposals(blank, empty, meetingDate)).toEqual([]);
  });
});
