import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireBotAccess } from "@/server/auth/guards";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusControls } from "./_components/status-controls";
import { GeneralTab } from "./_components/general-tab";
import { CatalogTab } from "./_components/catalog-tab";
import { WhatsAppTab } from "./_components/whatsapp-tab";
import { ConversationsTab } from "./_components/conversations-tab";
import type { BotStatus } from "@/generated/prisma/enums";

const statusTone: Record<BotStatus, "accent" | "warning" | "neutral"> = {
  ACTIVE: "accent",
  PAUSED: "warning",
  DRAFT: "neutral",
};

const statusLabel: Record<BotStatus, string> = {
  ACTIVE: "Activo",
  PAUSED: "Pausado",
  DRAFT: "Borrador",
};

export default async function BotDetailPage({
  params,
}: {
  params: Promise<{ botId: string }>;
}) {
  const { botId } = await params;
  await requireBotAccess(botId);

  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    include: {
      config: true,
      whatsappConnection: true,
      catalogItems: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!bot) notFound();

  const catalogItems = bot.catalogItems.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    price: item.price ? item.price.toString() : null,
    active: item.active,
  }));

  return (
    <div className="animate-fade-up">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{bot.name}</h1>
            <Badge tone={statusTone[bot.status]}>
              <StatusDot tone={statusTone[bot.status]} />
              {statusLabel[bot.status]}
            </Badge>
          </div>
          <p className="text-sm text-ink-muted">
            {bot.config?.companyName ?? "Sin empresa configurada"}
          </p>
        </div>
        <StatusControls botId={bot.id} status={bot.status} />
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="catalog">Catálogo</TabsTrigger>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="conversations">Conversaciones</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralTab botId={bot.id} config={bot.config} />
        </TabsContent>
        <TabsContent value="catalog">
          <CatalogTab botId={bot.id} items={catalogItems} />
        </TabsContent>
        <TabsContent value="whatsapp">
          <WhatsAppTab botId={bot.id} connection={bot.whatsappConnection} />
        </TabsContent>
        <TabsContent value="conversations">
          <ConversationsTab botId={bot.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
