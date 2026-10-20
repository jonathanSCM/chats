import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { KnowledgeManager } from "./_components/knowledge-manager";
import { KnowledgeAiEditor, type AiEditEntry } from "./_components/knowledge-ai-editor";

export default async function KnowledgePage() {
  const session = await auth();
  if (!session?.user.organizationId) redirect("/dashboard");
  if (session.user.role !== "OWNER" && session.user.role !== "SUPERADMIN") {
    redirect("/dashboard");
  }

  const items = await prisma.knowledgeItem.findMany({
    where: { organizationId: session.user.organizationId },
    include: { updatedBy: { select: { name: true, email: true } } },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });

  // Cambios hechos con el editor de IA (más recientes primero) y cuáles ya se revirtieron.
  const aiLogs = await prisma.auditLog.findMany({
    where: {
      organizationId: session.user.organizationId,
      entityType: "KnowledgeItem",
      action: { startsWith: "ai_edit_" },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const revertedIds = new Set(
    aiLogs
      .filter((l) => l.action === "ai_edit_revert")
      .map((l) => (l.after as { revertedAuditId?: string } | null)?.revertedAuditId)
      .filter((id): id is string => Boolean(id)),
  );
  const authorIds = [...new Set(aiLogs.map((l) => l.userId).filter((id): id is string => Boolean(id)))];
  const authors = authorIds.length
    ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const authorName = new Map(authors.map((u) => [u.id, u.name || u.email]));
  const itemTitle = new Map(items.map((i) => [i.id, i.title]));

  const aiHistory: AiEditEntry[] = aiLogs.slice(0, 15).map((l) => {
    const after = l.after as { title?: string; reason?: string } | null;
    const before = l.before as { title?: string } | null;
    return {
      id: l.id,
      action: l.action,
      title: after?.title ?? before?.title ?? itemTitle.get(l.entityId) ?? "Entrada",
      at: l.createdAt.toISOString(),
      by: l.userId ? (authorName.get(l.userId) ?? null) : null,
      reason: after?.reason ?? null,
      reverted: revertedIds.has(l.id),
    };
  });

  return (
    <div className="max-w-3xl animate-fade-up">
      <h1 className="mb-1 text-2xl font-bold">
        Base de conocimiento
      </h1>
      <p className="mb-8 text-sm text-ink-muted">
        Lo que el asesor de IA puede citar como información oficial de la empresa: servicios,
        precios, alcances, exclusiones y políticas. Si algo no está aquí, la IA no lo sabe.
      </p>

      <KnowledgeAiEditor history={aiHistory} />

      <KnowledgeManager
        items={items.map((item) => ({
          id: item.id,
          category: item.category,
          title: item.title,
          content: item.content,
          active: item.active,
          version: item.version,
          updatedAt: item.updatedAt.toISOString(),
          updatedBy: item.updatedBy?.name || item.updatedBy?.email || null,
        }))}
      />
    </div>
  );
}
