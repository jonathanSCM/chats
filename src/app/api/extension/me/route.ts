import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { listUserOrganizations } from "@/server/services/extension-meeting";

/**
 * Quién es la persona detrás del token de la extensión y a qué organizaciones puede mandar cosas: la extensión y el
 * userscript lo usan para mostrar el selector de organización antes de grabar o de llamar al asistente.
 */
const ALLOWED_ORIGIN = "https://meet.google.com";

function withCors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

export function OPTIONS(): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return withCors(new NextResponse("Unauthorized", { status: 401 }));

  const user = await prisma.user.findUnique({
    where: { meetExtensionToken: token },
    select: { id: true, name: true, organizationId: true },
  });
  if (!user?.organizationId) return withCors(new NextResponse("Unauthorized", { status: 401 }));

  const { organizations, activeOrganizationId } = await listUserOrganizations({ id: user.id, organizationId: user.organizationId });
  return withCors(NextResponse.json({ name: user.name, organizations, activeOrganizationId }));
}
