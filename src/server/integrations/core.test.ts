import { describe, expect, it } from "vitest";
import {
  ApiError,
  decodeCursor,
  encodeCursor,
  finishPage,
  keysetAfter,
  parseDate,
  parseLimit,
} from "./http";
import { generateApiKey, hashApiKey, isIntegrationScope } from "./keys";
import { hashRequest } from "./idempotency";
import { eventIds } from "./events";
import { serializeActivity, serializeMeeting, serializeMessage, serializeOpportunity } from "./serializers";

describe("claves de API", () => {
  it("genera claves únicas con prefijo y guarda solo el hash", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).toMatch(/^pk_live_[A-Za-z0-9_-]{43}$/);
    expect(a.key).not.toBe(b.key);
    expect(a.keyHash).toBe(hashApiKey(a.key));
    expect(a.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.key.startsWith(a.prefix)).toBe(true);
    expect(a.prefix.length).toBeLessThan(a.key.length / 2);
  });
  it("valida scopes", () => {
    expect(isIntegrationScope("read")).toBe(true);
    expect(isIntegrationScope("write:activities")).toBe(true);
    expect(isIntegrationScope("admin")).toBe(false);
  });
});

describe("paginación", () => {
  it("parseLimit: default, tope 200 y errores", () => {
    expect(parseLimit(null)).toBe(50);
    expect(parseLimit("10")).toBe(10);
    expect(parseLimit("5000")).toBe(200);
    for (const bad of ["0", "-1", "abc", "1.5"]) expect(() => parseLimit(bad)).toThrow(ApiError);
  });
  it("parseDate: null si falta y error si es inválida", () => {
    expect(parseDate(null, "since")).toBeNull();
    expect(parseDate("2026-10-01T00:00:00Z", "since")?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(() => parseDate("ayer", "since")).toThrow(ApiError);
  });
  it("cursor: ida y vuelta, y rechaza basura", () => {
    const t = new Date("2026-10-15T12:00:00.000Z");
    expect(decodeCursor(encodeCursor(t, "abc"))).toEqual({ t, id: "abc" });
    expect(decodeCursor(null)).toBeNull();
    expect(() => decodeCursor("%%%")).toThrow(ApiError);
    expect(() => decodeCursor(Buffer.from('{"t":"x","id":""}').toString("base64url"))).toThrow(ApiError);
  });
  it("keysetAfter cubre filas con el mismo timestamp", () => {
    const t = new Date("2026-10-15T12:00:00Z");
    expect(keysetAfter("updatedAt", null)).toEqual({});
    expect(keysetAfter("updatedAt", { t, id: "b" })).toEqual({
      OR: [{ updatedAt: { gt: t } }, { updatedAt: t, id: { gt: "b" } }],
    });
  });
  it("finishPage: sin sobrante no hay cursor; con sobrante apunta a la última fila devuelta", () => {
    const rows = [1, 2, 3].map((n) => ({ id: `r${n}`, at: new Date(2026, 0, n) }));
    expect(finishPage(rows.slice(0, 2), 2, (r) => r.at)).toEqual({ data: rows.slice(0, 2), nextCursor: null });
    const page = finishPage(rows, 2, (r) => r.at);
    expect(page.data).toHaveLength(2);
    expect(decodeCursor(page.nextCursor)).toEqual({ t: rows[1].at, id: "r2" });
  });
});

describe("idempotencia: hash del cuerpo", () => {
  it("no depende del orden de las claves", () => {
    expect(hashRequest({ a: 1, b: { x: 1, y: [1, 2] } })).toBe(hashRequest({ b: { y: [1, 2], x: 1 }, a: 1 }));
  });
  it("cambia si cambia un valor", () => {
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
  });
});

describe("eventId determinísticos", () => {
  it("transcripción: mismo texto = mismo id; texto corregido = id nuevo", () => {
    expect(eventIds.transcriptReady("m1", "hola")).toBe(eventIds.transcriptReady("m1", "hola"));
    expect(eventIds.transcriptReady("m1", "hola")).not.toBe(eventIds.transcriptReady("m1", "hola!"));
    expect(eventIds.transcriptReady("m1", "hola").length).toBeLessThan(200);
  });
  it("mensaje y actividad", () => {
    expect(eventIds.message("x")).toBe("msg_x");
    expect(eventIds.activityCreated("a")).toBe("act_a");
    expect(eventIds.activityCompleted("a")).toBe("actdone_a");
  });
});

describe("serializadores: lista blanca, sin secretos", () => {
  const FORBIDDEN = /token|secret|password|hash|encrypted|apikey/i;
  const keysOf = (o: unknown): string[] =>
    o && typeof o === "object"
      ? Object.entries(o).flatMap(([k, v]) => [k, ...(Array.isArray(v) ? v.flatMap(keysOf) : keysOf(v))])
      : [];

  const now = new Date("2026-10-15T12:00:00Z");
  it("ninguna salida expone campos sensibles aunque la fila los traiga", () => {
    const leaky = { metaAdsAccessToken: "x", passwordHash: "y", secretEncrypted: "z", meetExtensionToken: "w" };
    const outputs = [
      serializeActivity({
        id: "a", type: "TASK", title: "t", description: null, dueAt: null, assignedToId: null,
        opportunityId: null, contactId: null, source: "ai", status: "PENDING", completedAt: null, createdAt: now, ...leaky,
      }),
      serializeOpportunity({
        id: "o", title: "t", contactId: "c", assignedToId: null, priority: "ALTA", estimatedValue: "10.5",
        currency: "USD", nextAction: null, nextActionAt: null, updatedAt: now, stage: { label: "Nuevo" }, ...leaky,
      }),
      serializeMeeting({
        id: "m", title: null, scheduledAt: now, durationMinutes: 30, status: "DONE", opportunityId: null,
        transcript: null, audioTranscript: null, notes: null, aiSummary: null, aiSummaryData: null, aiSummaryAt: null,
        guestEmails: [], updatedAt: now, ...leaky,
      }),
      serializeMessage({
        id: "g", conversationId: "c", role: "CUSTOMER", content: "hola", mediaType: null, isVoiceNote: false,
        fileName: null, createdAt: now, ...leaky,
      }),
    ];
    for (const out of outputs) {
      for (const k of keysOf(out)) expect(k).not.toMatch(FORBIDDEN);
    }
  });
  it("reunión sin título → 'Reunión'; mensaje sin texto → null; Decimal → número", () => {
    const m = serializeMeeting({
      id: "m", title: "  ", scheduledAt: now, durationMinutes: 30, status: "DONE", opportunityId: null,
      transcript: null, audioTranscript: null, notes: null, aiSummary: null, aiSummaryData: null, aiSummaryAt: null,
      guestEmails: ["a@x.com"], updatedAt: now,
    });
    expect(m.title).toBe("Reunión");
    expect(m.attendees).toEqual(["a@x.com"]);
    expect(m.isTeam).toBe(false); // sin marcar: no es del equipo
    expect(serializeMeeting({ id: "m", title: "x", scheduledAt: now, durationMinutes: 30, status: "DONE", opportunityId: null, transcript: null, audioTranscript: null, notes: null, aiSummary: null, aiSummaryData: null, aiSummaryAt: null, guestEmails: [], isTeam: true, updatedAt: now }).isTeam).toBe(true);
    expect(
      serializeMessage({ id: "g", conversationId: "c", role: "STAFF", content: "  ", mediaType: "IMAGE", isVoiceNote: false, fileName: null, createdAt: now }).text,
    ).toBeNull();
    expect(
      serializeOpportunity({
        id: "o", title: "t", contactId: "c", assignedToId: null, priority: null, estimatedValue: { toString: () => "1250.50" },
        currency: "USD", nextAction: null, nextActionAt: null, updatedAt: now, stage: { label: "x" },
      }).estimatedValue,
    ).toBe(1250.5);
  });
});
