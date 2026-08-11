import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { InboxClient } from "./inbox-client";

export default async function InboxPage() {
  const session = await auth();
  const isAdmin = session?.user?.role === "OWNER" || session?.user?.role === "SUPERADMIN";

  let bots: { id: string; name: string }[] = [];
  if (session?.user?.organizationId) {
    if (isAdmin) {
      bots = await prisma.bot.findMany({
        where: { organizationId: session.user.organizationId },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      });
    } else if (session.user.id) {
      const memberships = await prisma.botMember.findMany({
        where: { userId: session.user.id },
        select: { bot: { select: { id: true, name: true } } },
        orderBy: { bot: { createdAt: "asc" } },
      });
      bots = memberships.map((m) => m.bot);
    }
  }

  return (
    <InboxClient
      currentUserId={session?.user?.id ?? ""}
      isAdmin={isAdmin}
      bots={bots}
    />
  );
}
