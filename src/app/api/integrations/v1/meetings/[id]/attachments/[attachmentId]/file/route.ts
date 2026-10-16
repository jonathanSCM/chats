import { NextResponse } from "next/server";
import { readMediaFile } from "@/lib/media-storage";
import { prisma } from "@/server/db/client";
import { ApiError } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";

export const dynamic = "force-dynamic";

export const GET = integrationRoute<{ id: string; attachmentId: string }>(
  "read",
  async (ctx, _req, { id, attachmentId }) => {
    const attachment = await prisma.meetingAttachment.findFirst({
      where: { id: attachmentId, meetingId: id, meeting: { organizationId: ctx.organizationId } },
      select: { url: true, fileName: true, mimeType: true },
    });
    if (!attachment) throw new ApiError(404, "not_found", "Adjunto no encontrado.");

    const storedName = attachment.url.split("/").pop()?.split("?")[0] ?? "";
    if (!storedName || storedName.includes("..") || /[\\/]/.test(storedName)) {
      throw new ApiError(404, "not_found", "Adjunto no encontrado.");
    }
    // S3 si está configurado; si no, disco local (/public/media).
    const buffer = await readMediaFile(storedName).catch(() => null);
    if (!buffer) throw new ApiError(404, "not_found", "Adjunto no encontrado.");

    const safeName = attachment.fileName.replace(/[^\w.\- ]/g, "_");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mimeType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
      },
    });
  },
);
