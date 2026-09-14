import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { resolveExtensionMeeting } from "@/server/services/extension-meeting";
import { audit } from "@/server/services/audit";

/**
 * Lo que llama el panel que la extensión muestra al cortar una reunión (ver
 * content.js) para decidir con qué cliente quedó, o solo renombrarla. Mismo
 * origen/CORS que api/extension/transcript, porque corre pegado a
 * meet.google.com igual que ese.
 */
const bodySchema = z.object({
  meetingUrl: z.string().min(1).max(500),
  opportunityId: z.string().optional(),
  newContactName: z.string().max(200).optional(),
  newContactPhone: z.string().max(50).optional(),
  newOpportunityTitle: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
});

const ALLOWED_ORIGIN = "https://meet.google.com";

function withCors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

export function OPTIONS(): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(new NextResponse("Datos inválidos", { status: 400 }));
  }
  const { meetingUrl, opportunityId, newContactName, newContactPhone, newOpportunityTitle, title } = parsed.data;

  const token = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) {
    return withCors(new NextResponse("Unauthorized", { status: 401 }));
  }

  const user = await prisma.user.findUnique({
    where: { meetExtensionToken: token },
    select: { id: true, organizationId: true },
  });
  if (!user?.organizationId) {
    return withCors(new NextResponse("Unauthorized", { status: 401 }));
  }
  const { organizationId, id: userId } = user;

  const resolved = await resolveExtensionMeeting({ organizationId, meetingUrl, recordedById: userId });

  if (opportunityId) {
    const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId }, select: { organizationId: true } });
    if (!opportunity || opportunity.organizationId !== organizationId) {
      return withCors(new NextResponse("Cliente no encontrado", { status: 404 }));
    }
    await prisma.meeting.update({ where: { id: resolved.id }, data: { opportunityId } });
    return withCors(NextResponse.json({ ok: true, meetingId: resolved.id, opportunityId }));
  }

  if (newContactPhone?.trim()) {
    // Mismo patrón que crm.ts createOpportunityAction: el teléfono es la
    // llave que también usa el webhook de WhatsApp, así que si el cliente
    // después escribe, se engancha solo a este mismo contacto.
    const phone = newContactPhone.trim();
    const contact = await prisma.contact.upsert({
      where: { organizationId_phone: { organizationId, phone } },
      create: { organizationId, phone, fullName: newContactName?.trim() || null, source: "Reunión" },
      update: {},
    });

    const opportunity = await prisma.opportunity.create({
      data: {
        organizationId,
        contactId: contact.id,
        title: newOpportunityTitle?.trim() || newContactName?.trim() || "Cliente nuevo",
        assignedToId: userId,
      },
    });

    await audit({
      entityType: "Opportunity",
      entityId: opportunity.id,
      action: "create",
      userId,
      organizationId,
      after: { title: opportunity.title, stage: opportunity.stage },
    });

    await prisma.meeting.update({ where: { id: resolved.id }, data: { opportunityId: opportunity.id } });
    return withCors(NextResponse.json({ ok: true, meetingId: resolved.id, opportunityId: opportunity.id }));
  }

  if (title?.trim()) {
    await prisma.meeting.update({ where: { id: resolved.id }, data: { title: title.trim() } });
  }

  return withCors(NextResponse.json({ ok: true, meetingId: resolved.id }));
}
