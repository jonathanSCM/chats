import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { STAGE_LABEL, LOSS_REASON_LABEL, type Stage, type Priority, type LossReason } from "@/lib/pipeline";

/**
 * Exporta los leads activos (no archivados) de la organización a un .xlsx
 * para editar/revisar offline -- solo exportación, no hay forma de volver a
 * subirlo (si en algún momento hace falta, es un cambio aparte).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const organizationId = session.user.organizationId;

  const opportunities = await prisma.opportunity.findMany({
    where: { organizationId, archivedAt: null },
    include: {
      contact: { select: { fullName: true, phone: true, city: true, source: true } },
      assignedTo: { select: { name: true, email: true } },
      meetings: {
        where: { status: { not: "CANCELED" } },
        select: { scheduledAt: true },
        orderBy: { scheduledAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Leads");

  sheet.columns = [
    { header: "Cliente", key: "client", width: 24 },
    { header: "Teléfono", key: "phone", width: 16 },
    { header: "Ciudad", key: "city", width: 16 },
    { header: "Origen", key: "source", width: 14 },
    { header: "Servicio", key: "service", width: 18 },
    { header: "Necesidad / contexto", key: "need", width: 40 },
    { header: "Etapa", key: "stage", width: 16 },
    { header: "Prioridad", key: "priority", width: 10 },
    { header: "Valor estimado (USD)", key: "estimatedValue", width: 18 },
    { header: "Próxima acción", key: "nextAction", width: 28 },
    { header: "Fecha próxima acción", key: "nextActionAt", width: 18 },
    { header: "Próxima reunión", key: "nextMeetingAt", width: 18 },
    { header: "Vendedor asignado", key: "assignedTo", width: 20 },
    { header: "Motivo de pérdida", key: "lostReason", width: 24 },
    { header: "Registrado", key: "registeredAt", width: 14 },
    { header: "Última actualización", key: "updatedAt", width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };

  const dateFmt = (d: Date | null | undefined) => (d ? d.toLocaleDateString("es") : "");

  for (const o of opportunities) {
    sheet.addRow({
      client: o.contact.fullName || "",
      phone: o.contact.phone,
      city: o.contact.city || "",
      source: o.contact.source || "",
      service: o.serviceInterest || "",
      need: o.needSummary || o.title,
      stage: STAGE_LABEL[o.stage as Stage] ?? o.stage,
      priority: (o.priority as Priority | null) || "",
      estimatedValue: o.estimatedValue ? Number(o.estimatedValue) : "",
      nextAction: o.nextAction || "",
      nextActionAt: dateFmt(o.nextActionAt),
      nextMeetingAt: dateFmt(o.meetings[0]?.scheduledAt),
      assignedTo: o.assignedTo?.name || o.assignedTo?.email || "Sin asignar",
      lostReason: o.lostReasonCategory ? LOSS_REASON_LABEL[o.lostReasonCategory as LossReason] : o.lostReason || "",
      registeredAt: dateFmt(o.createdAt),
      updatedAt: dateFmt(o.updatedAt),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `leads-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
