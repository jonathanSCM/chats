import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { KnowledgeManager } from "./_components/knowledge-manager";

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

  return (
    <div className="max-w-3xl animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">
        Base de conocimiento
      </h1>
      <p className="mb-8 text-sm text-ink-muted">
        Lo que el asesor de IA puede citar como información oficial de la empresa: servicios,
        precios, alcances, exclusiones y políticas. Si algo no está aquí, la IA no lo sabe.
      </p>

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
