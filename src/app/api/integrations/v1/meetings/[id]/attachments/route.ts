import { prisma } from "@/server/db/client";
import { ApiError, jsonResponse } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";

export const dynamic = "force-dynamic";

export const GET = integrationRoute<{ id: string }>("read", async (ctx, _req, { id }) => {
  const meeting = await prisma.meeting.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, attachments: { select: { id: true, fileName: true, mimeType: true, fileSize: true } } },
  });
  if (!meeting) throw new ApiError(404, "not_found", "Reunión no encontrada.");

  return jsonResponse({
    data: meeting.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      // Se baja con la misma clave de API; la URL interna del CRM no se reenvía.
      downloadUrl: `/api/integrations/v1/meetings/${meeting.id}/attachments/${a.id}/file`,
    })),
  });
});
