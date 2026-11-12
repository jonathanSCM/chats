import { describe, expect, it } from "vitest";
import { MAX_JOIN_RETRIES, decideConflict, describeJoinFailure, isTransientShotReason, joinRetryDelayMs, parseSessionId, pickSession, shouldRetryJoin, type VexaSessionEntry } from "./vexa-session";
import { SHOT_REASONS } from "./bot-shot";

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

const failed = (reason: string): Pick<VexaSessionEntry, "data" | "failure_stage"> => ({
  failure_stage: "joining",
  data: { join_evidence: { reason } },
});

describe("describeJoinFailure", () => {
  it("explica en palabras de una persona por qué no entró", () => {
    expect(describeJoinFailure(failed("awaiting_admission_timeout"))).toMatch(/Nadie admitió/);
    expect(describeJoinFailure(failed("awaiting_admission_rejected"))).toMatch(/rechazó/);
    expect(describeJoinFailure(failed("never_reached_lobby"))).toMatch(/Meet no dejó/);
    expect(describeJoinFailure({ failure_stage: "joining", data: null })).toMatch(/no pudo entrar/);
  });

  it("si Meet bloqueó al invitado («You can't join this video call») no dice que lo rechazó una persona", () => {
    const blocked = {
      failure_stage: "awaiting_admission",
      data: { join_evidence: { reason: "awaiting_admission_rejected", detail: "Google Meet blocked the guest: You can't join this video call (…)" } },
    };
    expect(describeJoinFailure(blocked)).toMatch(/Workspace/);
    expect(describeJoinFailure(blocked)).toMatch(/extensión/);
    expect(describeJoinFailure(blocked)).not.toMatch(/rechazó al asistente/);
    // un rechazo real del anfitrión sigue diciéndolo
    expect(
      describeJoinFailure({ failure_stage: "awaiting_admission", data: { join_evidence: { reason: "awaiting_admission_rejected", detail: "Bot admission was rejected by meeting admin" } } }),
    ).toMatch(/rechazó/);
  });
});

describe("shouldRetryJoin", () => {
  const base = { attempt: 0, scheduledInAdvance: true, meetingEnded: false };

  it("reintenta cuando Meet no mostró la sala", () => {
    expect(shouldRetryJoin({ ...base, entry: failed("never_reached_lobby"), scheduledInAdvance: false })).toBe(true);
  });

  it("reintenta una espera sin admisión solo si la reunión estaba agendada con tiempo", () => {
    expect(shouldRetryJoin({ ...base, entry: failed("awaiting_admission_timeout") })).toBe(true);
    expect(shouldRetryJoin({ ...base, entry: failed("awaiting_admission_timeout"), scheduledInAdvance: false })).toBe(false);
  });

  const googleBlock = { failure_stage: "awaiting_admission", data: { join_evidence: { reason: "awaiting_admission_rejected", detail: "Google Meet blocked the guest: You can't join this video call (…)" } } };

  it("reintenta el bloqueo automático de Google («You can't join this video call»), que no decidió una persona", () => {
    expect(shouldRetryJoin({ ...base, entry: googleBlock, scheduledInAdvance: false })).toBe(true);
    expect(shouldRetryJoin({ ...base, entry: googleBlock, attempt: MAX_JOIN_RETRIES })).toBe(false);
  });

  it("insiste hasta 3 veces, con espera creciente", () => {
    expect(MAX_JOIN_RETRIES).toBe(3);
    expect([0, 1, 2, 3].map(joinRetryDelayMs)).toEqual([15_000, 45_000, 90_000, 90_000]);
  });

  it("los motivos que anotan las capturas (página de inicio / bloqueado) se consideran pasajeros; el de iniciar sesión no", () => {
    expect(isTransientShotReason(SHOT_REASONS.inactive)).toBe(true);
    expect(isTransientShotReason(SHOT_REASONS.blocked)).toBe(true);
    expect(isTransientShotReason(SHOT_REASONS["sign-in"])).toBe(false);
    expect(isTransientShotReason(null)).toBe(false);
  });

  it("no reintenta tras un rechazo, una cancelación, una reunión terminada o con el tope alcanzado", () => {
    expect(shouldRetryJoin({ ...base, entry: failed("awaiting_admission_rejected") })).toBe(false); // rechazo del anfitrión
    expect(shouldRetryJoin({ ...base, entry: failed("stopped_while_joining") })).toBe(false);
    expect(shouldRetryJoin({ ...base, entry: failed("never_reached_lobby"), meetingEnded: true })).toBe(false);
    expect(shouldRetryJoin({ ...base, entry: failed("never_reached_lobby"), attempt: MAX_JOIN_RETRIES })).toBe(false);
  });
});
