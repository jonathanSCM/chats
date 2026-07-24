import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireBotAccess } from "@/server/auth/guards";
import { cn } from "@/lib/utils";
import { HandoffControls } from "./_components/handoff-controls";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ botId: string; conversationId: string }>;
}) {
  const { botId, conversationId } = await params;
  await requireBotAccess(botId);

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!conversation || conversation.botId !== botId) notFound();

  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <Link
        href={`/dashboard/bots/${botId}?tab=conversations`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={14} /> Volver a conversaciones
      </Link>

      <div className="mb-6">
        <h1 className="font-mono text-lg text-ink">{conversation.customerPhone}</h1>
        <p className="text-sm text-ink-muted">
          Iniciada el {conversation.startedAt.toLocaleString("es")}
        </p>
      </div>

      <HandoffControls botId={botId} conversationId={conversationId} paused={conversation.botPaused} />

      <div className="space-y-3">
        {conversation.messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex",
              message.role === "CUSTOMER" ? "justify-start" : "justify-end",
            )}
          >
            <div
              className={cn(
                "max-w-[75%] rounded-lg px-3.5 py-2.5 text-sm",
                message.role === "CUSTOMER" && "bg-surface-2 text-ink",
                message.role === "BOT" && "bg-accent text-accent-ink",
                message.role === "STAFF" && "border border-accent-dim text-ink",
                message.role === "SYSTEM" && "bg-transparent text-ink-faint text-xs italic",
              )}
            >
              {message.role === "STAFF" && (
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-accent">
                  Tú
                </p>
              )}
              {message.content}
              <div
                className={cn(
                  "mt-1 font-mono text-[10px] opacity-60",
                  message.role === "BOT" ? "text-accent-ink" : "text-ink-faint",
                )}
              >
                {message.createdAt.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
