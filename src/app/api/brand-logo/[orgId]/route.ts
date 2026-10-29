import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";

// Logo propio de una organización. Es público a propósito (los correos de invitación lo cargan sin
// sesión) y solo se sirve si el plan de esa organización permite cambiar la marca. La URL lleva
// `?v=<versión>`: cambia al subir un logo nuevo, así la caché larga no deja ver el viejo.
export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;

  const logo = await prisma.organizationBrandLogo.findUnique({
    where: { organizationId: orgId },
    select: { data: true, contentType: true, organization: { select: { canCustomizeBrand: true } } },
  });
  if (!logo || !logo.organization.canCustomizeBrand) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
