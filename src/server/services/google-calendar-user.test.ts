import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findMany: vi.fn(), refresh: vi.fn() }));

vi.mock("@/server/db/client", () => ({ prisma: { googleCalendarAccount: { findMany: m.findMany, update: vi.fn() } } }));
vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} on() {} refreshAccessToken = m.refresh } },
    calendar: () => ({}),
  },
}));

import { checkCalendarConnections, isRevokedGrantError } from "./google-calendar-user";

const account = (userId: string) => ({ userId, refreshToken: "r", accessToken: "a", tokenExpiresAt: new Date() });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "secret";
});

describe("isRevokedGrantError", () => {
  it("reconoce que el permiso ya no vale, y no confunde un fallo pasajero", () => {
    expect(isRevokedGrantError(new Error("invalid_grant: Token has been expired or revoked."))).toBe(true);
    expect(isRevokedGrantError({ response: { data: { error: "invalid_grant" } } })).toBe(true);
    expect(isRevokedGrantError({ code: 401 })).toBe(true);
    expect(isRevokedGrantError(new Error("getaddrinfo ENOTFOUND"))).toBe(false);
    expect(isRevokedGrantError({ code: 500 })).toBe(false);
  });
});

describe("checkCalendarConnections", () => {
  it("marca cada conexión: viva, caída o sin poder verificar", async () => {
    m.findMany.mockResolvedValue([account("ok"), account("roto"), account("red")]);
    m.refresh
      .mockResolvedValueOnce({ credentials: {} })
      .mockRejectedValueOnce(new Error("invalid_grant"))
      .mockRejectedValueOnce(new Error("socket hang up"));
    const res = await checkCalendarConnections(["ok", "roto", "red"]);
    expect(res.get("ok")).toBe("ok");
    expect(res.get("roto")).toBe("broken");
    expect(res.get("red")).toBe("unknown");
  });

  it("sin usuarios no consulta nada", async () => {
    expect((await checkCalendarConnections([])).size).toBe(0);
    expect(m.findMany).not.toHaveBeenCalled();
  });
});
