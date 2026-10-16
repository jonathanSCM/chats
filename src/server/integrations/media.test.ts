import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ messageFindFirst: vi.fn(), attachmentFindFirst: vi.fn(), readMediaFile: vi.fn() }));

vi.mock("@/server/db/client", () => ({
  prisma: { message: { findFirst: db.messageFindFirst }, meetingAttachment: { findFirst: db.attachmentFindFirst } },
}));
vi.mock("@/lib/media-storage", () => ({ readMediaFile: db.readMediaFile }));
vi.mock("@/server/integrations/auth", () => ({
  authenticateIntegration: vi.fn(async () => ({ organizationId: "orgA", keyId: "k1", scopes: ["read"] })),
}));

import { GET as messageMedia } from "@/app/api/integrations/v1/messages/[id]/media/route";
import { GET as attachmentFile } from "@/app/api/integrations/v1/meetings/[id]/attachments/[attachmentId]/file/route";

const ctx = <P>(params: P) => ({ params: Promise.resolve(params) });
const get = () => new Request("http://x/api");

beforeEach(() => {
  vi.clearAllMocks();
  db.readMediaFile.mockResolvedValue(Buffer.from("%PDF-1.4 contenido"));
});

describe("GET /messages/{id}/media", () => {
  it("devuelve el archivo (S3 o disco local, lo resuelve readMediaFile) con su tipo y nombre", async () => {
    db.messageFindFirst.mockResolvedValue({
      mediaUrl: "/media/abc-123.pdf",
      mimeType: "application/pdf",
      fileName: "Contrato final.pdf",
    });
    const res = await messageMedia(get(), ctx({ id: "g1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Contrato final.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.4 contenido");
    expect(db.readMediaFile).toHaveBeenCalledWith("abc-123.pdf");
  });

  it("solo mensajes de la propia organizacion (404 si no)", async () => {
    db.messageFindFirst.mockResolvedValue(null);
    const res = await messageMedia(get(), ctx({ id: "ajeno" }));
    expect(res.status).toBe(404);
    expect(db.messageFindFirst.mock.calls[0][0].where).toEqual({
      id: "ajeno",
      conversation: { bot: { organizationId: "orgA" } },
    });
    expect(db.readMediaFile).not.toHaveBeenCalled();
  });

  it("no sirve nombres con '..' (path traversal)", async () => {
    db.messageFindFirst.mockResolvedValue({ mediaUrl: "/media/a..b", mimeType: null, fileName: null });
    const res = await messageMedia(get(), ctx({ id: "g1" }));
    expect(res.status).toBe(404);
    expect(db.readMediaFile).not.toHaveBeenCalled();
  });

  it("archivo que no esta en el almacenamiento: 404, no 500", async () => {
    db.messageFindFirst.mockResolvedValue({ mediaUrl: "/media/abc.pdf", mimeType: "application/pdf", fileName: null });
    db.readMediaFile.mockRejectedValue(new Error("ENOENT"));
    expect((await messageMedia(get(), ctx({ id: "g1" }))).status).toBe(404);
  });
});

describe("GET /meetings/{id}/attachments/{attachmentId}/file", () => {
  it("devuelve el adjunto de una reunion de la propia organizacion", async () => {
    db.attachmentFindFirst.mockResolvedValue({ url: "/api/media/f1.pdf?x=1", fileName: "acta.pdf", mimeType: "application/pdf" });
    const res = await attachmentFile(get(), ctx({ id: "m1", attachmentId: "a1" }));
    expect(res.status).toBe(200);
    expect(db.readMediaFile).toHaveBeenCalledWith("f1.pdf");
    expect(db.attachmentFindFirst.mock.calls[0][0].where).toEqual({
      id: "a1",
      meetingId: "m1",
      meeting: { organizationId: "orgA" },
    });
  });

  it("adjunto ajeno o inexistente: 404", async () => {
    db.attachmentFindFirst.mockResolvedValue(null);
    expect((await attachmentFile(get(), ctx({ id: "m1", attachmentId: "x" }))).status).toBe(404);
    expect(db.readMediaFile).not.toHaveBeenCalled();
  });
});
