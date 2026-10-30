import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { buildVCard, vcardFileName } from "@/lib/vcard";

// Descarga la ficha de un contacto como tarjeta .vcf para guardarla en la agenda del teléfono.
// Solo contactos de la organización de quien la pide.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const contact = await prisma.contact.findUnique({
    where: { id },
    select: {
      organizationId: true,
      fullName: true,
      phone: true,
      email: true,
      jobTitle: true,
      city: true,
      country: true,
      company: { select: { name: true } },
    },
  });
  // Mismo mensaje si no existe o es de otra organización: no se revela cuál de los dos es.
  if (!contact || contact.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  }

  const body = buildVCard({ ...contact, company: contact.company?.name ?? null });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${vcardFileName(contact)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
