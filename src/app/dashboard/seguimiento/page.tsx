import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { isOpenStage, type Stage, type Priority } from "@/lib/pipeline";
import { getAiSpendToday } from "@/server/actions/crm";
import { TrackingTable } from "./_components/tracking-table";

export default async function SeguimientoPage() {
  const session = await auth();
  if (!session?.user.organizationId) redirect("/dashboard");

  const organizationId = session.user.organizationId;
  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";

  // El vendedor ve su cartera; el admin ve todo, igual que en la bandeja.
  const scope = isAdmin ? {} : { assignedToId: session.user.id };

  const [opportunities, contacts, ai] = await Promise.all([
    prisma.opportunity.findMany({
      where: { organizationId, ...scope },
      include: {
        contact: { select: { id: true, fullName: true, phone: true, city: true } },
        assignedTo: { select: { id: true, name: true, email: true, color: true } },
      },
      orderBy: [{ nextContactAt: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.contact.findMany({
      where: { organizationId },
      select: { id: true, fullName: true, phone: true },
      orderBy: { lastContactAt: "desc" },
      take: 300,
    }),
    getAiSpendToday(organizationId),
  ]);

  const rows = opportunities.map((o) => ({
    id: o.id,
    registeredAt: o.createdAt.toISOString(),
    client: o.contact.fullName ?? "",
    phone: o.contact.phone,
    city: o.contact.city ?? "",
    service: o.serviceInterest ?? "",
    need: o.needSummary ?? o.title,
    stage: o.stage as Stage,
    lastUpdate: o.lastUpdate ?? "",
    priority: (o.priority as Priority | null) ?? null,
    nextContactAt: o.nextContactAt?.toISOString() ?? null,
    probability: o.probability,
    aiRecommendation: o.aiRecommendation ?? "",
    aiSuggestedMessage: o.aiSuggestedMessage ?? "",
    assignedTo: o.assignedTo
      ? { id: o.assignedTo.id, name: o.assignedTo.name || o.assignedTo.email, color: o.assignedTo.color }
      : null,
  }));

  // Los mismos cuatro indicadores que el equipo lleva arriba de su planilla.
  const open = rows.filter((r) => isOpenStage(r.stage));
  const nextContactDates = open
    .map((r) => r.nextContactAt)
    .filter((d): d is string => Boolean(d))
    .sort();

  return (
    <div className="animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Seguimiento</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Clientes con cotización enviada y próxima acción comercial para avanzar al cierre.
      </p>

      <TrackingTable
        rows={rows}
        contacts={contacts.map((c) => ({ id: c.id, label: c.fullName || c.phone }))}
        currentUserId={session.user.id}
        ai={ai}
        summary={{
          inFollowUp: open.length,
          quotesSent: rows.filter((r) => r.stage === "COTI_ENVIADA").length,
          highPriority: open.filter((r) => r.priority === "ALTA").length,
          nextContact: nextContactDates[0] ?? null,
        }}
      />
    </div>
  );
}
