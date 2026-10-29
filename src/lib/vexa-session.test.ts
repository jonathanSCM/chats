import { describe, expect, it } from "vitest";
import { decideConflict, parseSessionId, pickSession, type VexaSessionEntry } from "./vexa-session";

const entry = (over: Partial<VexaSessionEntry>): VexaSessionEntry => ({
  id: 1,
  status: "completed",
  native_meeting_id: "abc-defg-hij",
  platform: "google_meet",
  created_at: "2026-10-29T10:00:00Z",
  updated_at: "2026-10-29T10:30:00Z",
  ...over,
});

describe("parseSessionId", () => {
  it("lee el id en las formas que puede devolver Vexa", () => {
    expect(parseSessionId({ id: 82 })).toBe(82);
    expect(parseSessionId({ meeting_id: 83 })).toBe(83);
    expect(parseSessionId({ meeting: { id: 84 } })).toBe(84);
  });

  it("rechaza lo que no es un id válido", () => {
    for (const bad of [null, undefined, "82", { id: "82" }, { id: 0 }, { id: -3 }, { id: 1.5 }, {}, []]) {
      expect(parseSessionId(bad)).toBeNull();
    }
  });
});

describe("pickSession", () => {
  const list = [
    entry({ id: 80, created_at: "2026-10-27T10:00:00Z" }),
    entry({ id: 82, created_at: "2026-10-29T22:21:00Z" }),
    entry({ id: 83, created_at: "2026-10-29T22:53:00Z" }),
    entry({ id: 99, native_meeting_id: "otra-sala-xyz", created_at: "2026-10-29T23:00:00Z" }),
  ];

  it("con id de sesión devuelve exactamente esa, aunque haya otras más nuevas de la misma sala", () => {
    expect(pickSession(list, { sessionId: 82, nativeId: "abc-defg-hij", sinceMs: 0 })?.id).toBe(82);
  });

  it("con id de sesión que todavía no aparece, no adivina otra de la misma sala", () => {
    expect(pickSession(list, { sessionId: 555, nativeId: "abc-defg-hij", sinceMs: 0 })).toBeNull();
  });

  it("sin id (reuniones viejas) toma la más nueva de esa sala creada desde que se pidió el bot", () => {
    const since = new Date("2026-10-29T22:50:00Z").getTime();
    expect(pickSession(list, { sessionId: null, nativeId: "abc-defg-hij", sinceMs: since })?.id).toBe(83);
  });

  it("sin id no toma sesiones anteriores a cuando se pidió el bot (una sala reutilizada)", () => {
    const since = new Date("2026-10-30T00:00:00Z").getTime();
    expect(pickSession(list, { sessionId: null, nativeId: "abc-defg-hij", sinceMs: since })).toBeNull();
  });

  it("no mezcla salas distintas", () => {
    expect(pickSession(list, { sessionId: null, nativeId: "otra-sala-xyz", sinceMs: 0 })?.id).toBe(99);
  });
});

describe("decideConflict (Vexa dijo que ya hay un bot en la sala)", () => {
  const active = entry({ id: 90, status: "active", created_at: "2026-10-29T22:00:00Z" });

  it("adopta la sesión si la propia reunión ya la tenía", () => {
    expect(decideConflict({ list: [active], nativeId: "abc-defg-hij", ownSessionId: 90, sameOrgSessionIds: new Set() })).toEqual({
      action: "adopt",
      sessionId: 90,
    });
  });

  it("adopta la sesión si otra reunión de la MISMA organización la inició", () => {
    expect(decideConflict({ list: [active], nativeId: "abc-defg-hij", ownSessionId: null, sameOrgSessionIds: new Set([90]) })).toEqual({
      action: "adopt",
      sessionId: 90,
    });
  });

  it("NO adopta una sesión de otra organización (o de la que no se sabe de quién es)", () => {
    expect(decideConflict({ list: [active], nativeId: "abc-defg-hij", ownSessionId: null, sameOrgSessionIds: new Set([7]) })).toEqual({
      action: "refuse",
    });
  });

  it("ignora sesiones ya terminadas de la misma sala", () => {
    const done = entry({ id: 91, status: "completed" });
    expect(decideConflict({ list: [done], nativeId: "abc-defg-hij", ownSessionId: null, sameOrgSessionIds: new Set([91]) })).toEqual({
      action: "retry",
    });
  });

  it("si hay varias activas toma la más nueva", () => {
    const older = entry({ id: 70, status: "joining", created_at: "2026-10-29T20:00:00Z" });
    const r = decideConflict({ list: [older, active], nativeId: "abc-defg-hij", ownSessionId: null, sameOrgSessionIds: new Set([70, 90]) });
    expect(r).toEqual({ action: "adopt", sessionId: 90 });
  });
});
