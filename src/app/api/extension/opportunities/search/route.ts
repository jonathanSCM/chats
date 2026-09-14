import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/client";

/**
 * Búsqueda rápida de clientes/oportunidades para el panel que la extensión
 * muestra al cortar una reunión (ver content.js) -- misma auth por Bearer
 * contra User.meetExtensionToken que el resto de /api/extension/*. El
 * Authorization header vuelve esto una request "no simple" para el
 * navegador (aunque sea GET), así que necesita el mismo preflight CORS que
 * las rutas POST de acá al lado.
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
  if (!token) {
    return withCors(new NextResponse("Unauthorized", { status: 401 }));
  }

  const user = await prisma.user.findUnique({
    where: { meetExtensionToken: token },
    select: { organizationId: true },
  });
  if (!user?.organizationId) {
    return withCors(new NextResponse("Unauthorized", { status: 401 }));
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return withCors(NextResponse.json({ results: [] }));
  }

  const opportunities = await prisma.opportunity.findMany({
    where: {
      organizationId: user.organizationId,
      archivedAt: null,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { contact: { fullName: { contains: q, mode: "insensitive" } } },
        { contact: { phone: { contains: q } } },
      ],
    },
    select: { id: true, title: true, contact: { select: { fullName: true, phone: true } } },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });

  return withCors(
    NextResponse.json({
      results: opportunities.map((o) => ({
        id: o.id,
        title: o.title,
        contactName: o.contact.fullName || o.contact.phone,
      })),
    }),
  );
}
