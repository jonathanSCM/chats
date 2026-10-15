import { prisma } from "@/server/db/client";
import { jsonResponse } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";

export const dynamic = "force-dynamic";

// Equipo humano de la organización. El rol sale de la membresía (es por
// organización); las cuentas técnicas SYSTEM y SUPERADMIN no son equipo.
export const GET = integrationRoute("read", async (ctx) => {
  const memberships = await prisma.organizationMembership.findMany({
    where: {
      organizationId: ctx.organizationId,
      role: { in: ["OWNER", "MEMBER"] },
      user: { role: { not: "SYSTEM" } },
    },
    select: { role: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return jsonResponse({
    data: memberships.map((m) => ({
      id: m.user.id,
      name: m.user.name ?? m.user.email,
      email: m.user.email,
      role: m.role,
    })),
  });
});
