import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/server/auth/guards", () => ({
  requireSession: m.session,
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/server/services/org-hierarchy-admin", () => ({ attachToParent: m.attach, detachFromParent: m.detach }));

import { setOrgParentAction } from "./admin-hierarchy";

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "sa1", role: "SUPERADMIN" } });
  m.attach.mockResolvedValue({ ok: true, warnings: [] });
  m.detach.mockResolvedValue({ ok: true, warnings: [] });
});

describe("setOrgParentAction", () => {
  it("solo el superadmin: el dueño de una organización no puede elegir su padre", async () => {
    m.session.mockResolvedValue({ user: { id: "u1", role: "OWNER", organizationId: "org1" } });
    await expect(setOrgParentAction("org1", { error: null }, form({ parentId: "p1" }))).rejects.toThrow(/superadmin/i);
    expect(m.attach).not.toHaveBeenCalled();
    expect(m.detach).not.toHaveBeenCalled();
  });

  it("con un padre elegido, une la organización", async () => {
    const r = await setOrgParentAction("org1", { error: null }, form({ parentId: "p1" }));
    expect(r.error).toBeNull();
    expect(m.attach).toHaveBeenCalledWith({ orgId: "org1", parentId: "p1", byUserId: "sa1" });
    expect(m.detach).not.toHaveBeenCalled();
    expect(r.message).toMatch(/suborganización/);
  });

  it("sin padre elegido, la desvincula; la casilla decide si se quita el acceso de los del padre", async () => {
    await setOrgParentAction("org1", { error: null }, form({ parentId: "", removeParentUsers: "on" }));
    expect(m.detach).toHaveBeenCalledWith({ orgId: "org1", removeParentUsers: true, byUserId: "sa1" });
    await setOrgParentAction("org1", { error: null }, form({ parentId: "" }));
    expect(m.detach).toHaveBeenLastCalledWith({ orgId: "org1", removeParentUsers: false, byUserId: "sa1" });
  });

  it("devuelve el motivo si el servicio rechaza y no refresca nada", async () => {
    m.attach.mockResolvedValue({ ok: false, error: "Solo hay un nivel." });
    const r = await setOrgParentAction("org1", { error: null }, form({ parentId: "p1" }));
    expect(r.error).toBe("Solo hay un nivel.");
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it("incluye las advertencias en el mensaje", async () => {
    m.attach.mockResolvedValue({ ok: true, warnings: ["El grupo queda con 3 administradores y el plan permite 2."] });
    const r = await setOrgParentAction("org1", { error: null }, form({ parentId: "p1" }));
    expect(r.message).toMatch(/3 administradores/);
  });
});
