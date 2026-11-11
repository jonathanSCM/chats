import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { loadExtensionFiles } from "@/lib/extension-package";

export const dynamic = "force-dynamic";

/** Archivos de la extensión desplegada, para que ella misma se actualice (con el token de la extensión). */
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return new NextResponse("Unauthorized", { status: 401 });
  const user = await prisma.user.findUnique({ where: { meetExtensionToken: token }, select: { id: true } });
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const pkg = await loadExtensionFiles();
  if (!pkg) return new NextResponse("No disponible", { status: 404 });
  return NextResponse.json(pkg, { headers: { "Cache-Control": "no-store" } });
}
