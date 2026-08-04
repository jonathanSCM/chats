import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { ALL_STAGES, isOpenStage, type Stage } from "@/lib/pipeline";
import { PipelineBoard } from "./_components/pipeline-board";

export default async function PipelinePage() {
  const session = await auth();
  if (!session?.user.organizationId) redirect("/dashboard");

  const organizationId = session.user.organizationId;
  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";

  // Un vendedor ve su cartera; el admin ve todo (igual que en la bandeja).
  const scope = isAdmin ? {} : { assignedToId: session.user.id };

  const [opportunities, contacts, pendingActivities] = await Promise.all([
    prisma.opportunity.findMany({
      where: { organizationId, ...scope },
      include: {
        contact: { select: { id: true, fullName: true, phone: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.contact.findMany({
      where: { organizationId },
      select: { id: true, fullName: true, phone: true },
      orderBy: { lastContactAt: "desc" },
      take: 200,
    }),
    prisma.activity.findMany({
      where: { organizationId, status: "PENDING", ...(isAdmin ? {} : { assignedToId: session.user.id }) },
      select: { id: true, title: true, dueAt: true, opportunityId: true },
      orderBy: { dueAt: "asc" },
    }),
  ]);

  const openOnes = opportunities.filter((o) => isOpenStage(o.stage as Stage));
  const pipelineValue = openOnes.reduce(
    (sum, o) => sum + Number(o.estimatedValue ?? 0),
    0,
  );
  const withoutNextAction = openOnes.filter((o) => !o.nextAction).length;

  return (
    <div className="animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Embudo</h1>
      <p className="mb-6 text-sm text-ink-muted">
        {isAdmin ? "Todas las oportunidades del equipo." : "Tus oportunidades."}
      </p>

      <PipelineBoard
        stages={ALL_STAGES}
        currentUserId={session.user.id}
        pipelineValue={pipelineValue}
        openCount={openOnes.length}
        withoutNextAction={withoutNextAction}
        contacts={contacts.map((c) => ({
          id: c.id,
          label: c.fullName || c.phone,
        }))}
        activitiesByOpportunity={pendingActivities.reduce<Record<string, number>>(
          (acc, a) => {
            if (a.opportunityId) acc[a.opportunityId] = (acc[a.opportunityId] ?? 0) + 1;
            return acc;
          },
          {},
        )}
        opportunities={opportunities.map((o) => ({
          id: o.id,
          title: o.title,
          stage: o.stage as Stage,
          estimatedValue: o.estimatedValue ? Number(o.estimatedValue) : null,
          currency: o.currency,
          leadScore: o.leadScore,
          nextAction: o.nextAction,
          nextActionAt: o.nextActionAt?.toISOString() ?? null,
          contact: {
            id: o.contact.id,
            label: o.contact.fullName || o.contact.phone,
          },
          assignedTo: o.assignedTo
            ? { id: o.assignedTo.id, name: o.assignedTo.name || o.assignedTo.email }
            : null,
        }))}
      />
    </div>
  );
}
