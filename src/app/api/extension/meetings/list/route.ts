import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { resolveExtensionOrg } from "@/server/services/extension-meeting";

/**
 * Reuniones del CRM entre las que la persona puede elegir, en el panel de la extensión, a cuál pertenece lo que va a grabar.
 * `scope=upcoming` (por defecto): las de hoy en adelante; `scope=all`: todas, de la más reciente a la más antigua. `q` busca por
 * nombre, cliente u oportunidad. Misma auth por Bearer que el resto de /api/extension/*.
 */
const PAGE = 40;
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
    select: { id: true, organizationId: true, email: true },
  });
  if (!user?.organizationId) return withCors(new NextResponse("Unauthorized", { status: 401 }));

  const params = req.nextUrl.searchParams;
  const org = await resolveExtensionOrg({
    user: { id: user.id, organizationId: user.organizationId, email: user.email },
    meetingUrl: "",
    requestedOrganizationId: params.get("organizationId"),
  });
  if (!org.ok) return withCors(new NextResponse(org.error, { status: 403 }));

  const all = params.get("scope") === "all";
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  const skip = Math.max(0, Math.min(Number(params.get("skip")) || 0, 5000));
  // «Hoy en adelante»: desde 6 h atrás, para que también salga la reunión que empezó hace un rato y sigue en curso.
  const from = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const rows = await prisma.meeting.findMany({
    where: {
      organizationId: org.organizationId,
      status: { not: "CANCELED" },
      ...(all ? {} : { scheduledAt: { gte: from } }),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { opportunity: { title: { contains: q, mode: "insensitive" } } },
              { opportunity: { contact: { fullName: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: { scheduledAt: all ? "desc" : "asc" },
    skip,
    take: PAGE + 1,
    select: {
      id: true,
      title: true,
      scheduledAt: true,
      status: true,
      meetingUrl: true,
      transcript: true,
      audioTranscript: true,
      opportunity: { select: { title: true, contact: { select: { fullName: true } } } },
    },
  });

  const meetings = rows.slice(0, PAGE).map((m) => ({
    id: m.id,
    title: m.title || m.opportunity?.title || "Reunión sin nombre",
    client: m.opportunity?.contact?.fullName ?? null,
    scheduledAt: m.scheduledAt.toISOString(),
    status: m.status,
    meetingUrl: m.meetingUrl,
    hasTranscript: Boolean(m.transcript || m.audioTranscript),
  }));
  return withCors(NextResponse.json({ meetings, hasMore: rows.length > PAGE }));
}
