import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  messageFind: vi.fn(),
  messageUpdate: vi.fn(),
  connFind: vi.fn(),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
  saveMediaFile: vi.fn(),
  emitDocumentReceived: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    message: { findUnique: m.messageFind, update: m.messageUpdate, updateMany: vi.fn() },
    whatsAppConnection: { findUnique: m.connFind },
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => `dec(${s})` }));
vi.mock("@/server/services/whatsapp", () => ({ getMediaUrl: m.getMediaUrl, downloadMedia: m.downloadMedia }));
vi.mock("@/lib/media-storage", () => ({ saveMediaFile: m.saveMediaFile }));
vi.mock("@/server/integrations/domain-events", () => ({ emitDocumentReceived: m.emitDocumentReceived }));

import { handleDownloadMedia } from "./download-media";

const payload = { messageId: "g1", mediaId: "media1", phoneNumberId: "pn1" };

beforeEach(() => {
  vi.clearAllMocks();
  m.messageFind.mockResolvedValue({ id: "g1", mediaStatus: "PENDING", mimeType: "application/pdf" });
  m.connFind.mockResolvedValue({ accessToken: "tok" });
  m.getMediaUrl.mockResolvedValue({ url: "https://cdn/x", mimeType: "application/pdf" });
  m.downloadMedia.mockResolvedValue(Buffer.from("%PDF"));
  m.saveMediaFile.mockResolvedValue("/media/abc.pdf");
  m.messageUpdate.mockResolvedValue({});
  m.emitDocumentReceived.mockResolvedValue(undefined);
});

describe("handleDownloadMedia + document.received", () => {
  it("al terminar de guardar el archivo avisa al integrador", async () => {
    await handleDownloadMedia(payload);
    expect(m.messageUpdate.mock.calls[0][0].data).toMatchObject({ mediaUrl: "/media/abc.pdf", mediaStatus: "READY" });
    expect(m.emitDocumentReceived).toHaveBeenCalledWith("g1");
    // Primero se guarda el estado READY y despues se avisa (el integrador necesita poder descargarlo).
    expect(m.messageUpdate.mock.invocationCallOrder[0]).toBeLessThan(m.emitDocumentReceived.mock.invocationCallOrder[0]);
  });

  it("si ya estaba descargado no repite nada ni vuelve a avisar", async () => {
    m.messageFind.mockResolvedValue({ id: "g1", mediaStatus: "READY", mimeType: "application/pdf" });
    await handleDownloadMedia(payload);
    expect(m.downloadMedia).not.toHaveBeenCalled();
    expect(m.emitDocumentReceived).not.toHaveBeenCalled();
  });

  it("si la descarga falla no avisa y propaga el error (la cola reintenta)", async () => {
    m.downloadMedia.mockRejectedValue(new Error("CDN 500"));
    await expect(handleDownloadMedia(payload)).rejects.toThrow("CDN 500");
    expect(m.emitDocumentReceived).not.toHaveBeenCalled();
  });
});
