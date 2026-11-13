import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  userFind: vi.fn(),
  meetingUpdate: vi.fn(),
  attachmentCreate: vi.fn(),
  resolveOrg: vi.fn(),
  resolveMeeting: vi.fn(),
  save: vi.fn(),
  link: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    user: { findUnique: m.userFind },
    meeting: { update: m.meetingUpdate },
    meetingAttachment: { create: m.attachmentCreate },
  },
}));
vi.mock("@/lib/media-storage", () => ({ saveMediaFile: m.save }));
vi.mock("@/server/services/meeting-link", () => ({ attemptAutoLinkMeeting: m.link }));
vi.mock("@/server/services/extension-meeting", async (importActual) => ({
  ...(await importActual<typeof import("@/server/services/extension-meeting")>()),
  ExtensionMeetingNotFoundError: class extends Error {},
  isPlatformBotEmail: () => false,
  resolveExtensionOrg: m.resolveOrg,
  resolveExtensionMeeting: m.resolveMeeting,
}));

import { POST } from "./route";

const call = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("http://localhost/api/extension/transcript", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ meetingUrl: "https://meet.google.com/abc-defg-hij", recordingId: "rec-1", ...body }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.userFind.mockResolvedValue({ id: "u1", organizationId: "org1", email: "v@x.com" });
  m.resolveOrg.mockResolvedValue({ ok: true, organizationId: "org1" });
  m.resolveMeeting.mockResolvedValue({ id: "m1", transcript: null });
  m.meetingUpdate.mockResolvedValue({ id: "m1" });
  m.save.mockResolvedValue("/media/x.txt");
  m.link.mockResolvedValue(undefined);
});

describe("POST /api/extension/transcript (envío por partes)", () => {
  it("una parte intermedia (final=false) guarda el texto sin crear adjunto ni auto-vincular", async () => {
    const res = await call({ transcript: "Ana: hola", final: false });
    expect(res.status).toBe(200);
    expect(m.meetingUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { transcript: "Ana: hola" } }));
    expect(m.attachmentCreate).not.toHaveBeenCalled();
    expect(m.link).not.toHaveBeenCalled();
  });

  it("la parte siguiente se SUMA a lo ya guardado (no lo pisa ni lo duplica)", async () => {
    m.resolveMeeting.mockResolvedValue({ id: "m1", transcript: "Ana: hola" });
    await call({ transcript: "Luis: buenas", final: false });
    expect(m.meetingUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { transcript: "Ana: hola\n\nLuis: buenas" } }));
  });

  it("el cierre con texto nuevo guarda el adjunto con el texto COMPLETO y auto-vincula", async () => {
    m.resolveMeeting.mockResolvedValue({ id: "m1", transcript: "Ana: hola" });
    const res = await call({ transcript: "Luis: adiós", final: true });
    expect(res.status).toBe(200);
    expect(m.save).toHaveBeenCalledWith(Buffer.from("Ana: hola\n\nLuis: adiós", "utf-8"), "text/plain");
    expect(m.attachmentCreate).toHaveBeenCalledTimes(1);
    expect(m.link).toHaveBeenCalledWith("m1");
  });

  it("el cierre SIN texto nuevo (todo se mandó por partes) igual guarda el adjunto con lo acumulado y no toca la transcripción", async () => {
    m.resolveMeeting.mockResolvedValue({ id: "m1", transcript: "Ana: hola\n\nLuis: adiós" });
    const res = await call({ transcript: "", final: true });
    expect(res.status).toBe(200);
    expect(m.meetingUpdate).not.toHaveBeenCalled();
    expect(m.save).toHaveBeenCalledWith(Buffer.from("Ana: hola\n\nLuis: adiós", "utf-8"), "text/plain");
    expect(m.attachmentCreate).toHaveBeenCalledTimes(1);
  });

  it("un cierre sin texto y sin nada acumulado se ignora (no hay qué cerrar)", async () => {
    const res = await call({ transcript: "", final: true });
    expect(res.status).toBe(202);
    expect(m.attachmentCreate).not.toHaveBeenCalled();
  });

  it("una parte intermedia vacía se ignora sin siquiera buscar la reunión", async () => {
    const res = await call({ transcript: "   ", final: false });
    expect(res.status).toBe(202);
    expect(m.resolveMeeting).not.toHaveBeenCalled();
  });

  it("sin token responde 401", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/extension/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl: "https://meet.google.com/abc-defg-hij", transcript: "x", final: true }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
