import { NextResponse } from "next/server";
import { readMediaFile } from "@/lib/media-storage";
import { prisma } from "@/server/db/client";
import { ApiError } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";

export const dynamic = "force-dynamic";

// Descarga controlada: solo archivos de mensajes de la propia organización, con la
// misma clave de API (sin URLs públicas ni firmadas que se puedan reenviar).
export const GET = integrationRoute<{ id: string }>("read", async (ctx, _req, { id }) => {
  const message = await prisma.message.findFirst({
    where: { id, conversation: { bot: { organizationId: ctx.organizationId } } },
    select: { mediaUrl: true, mimeType: true, fileName: true },
  });
  if (!message?.mediaUrl) throw new ApiError(404, "not_found", "Archivo no encontrado.");

  const storedName = message.mediaUrl.split("/").pop() ?? "";
  // Solo el nombre generado (uuid.ext): nada de separadores ni ".." (path traversal).
  if (!storedName || storedName.includes("..") || /[\\/]/.test(storedName)) {
    throw new ApiError(404, "not_found", "Archivo no encontrado.");
  }

  // readMediaFile lee de S3 si está configurado y, si no, del disco local (/public/media).
  const buffer = await readMediaFile(storedName).catch(() => null);
  if (!buffer) throw new ApiError(404, "not_found", "Archivo no encontrado.");

  const safeName = (message.fileName ?? storedName).replace(/[^\w.\- ]/g, "_");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": message.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
});
