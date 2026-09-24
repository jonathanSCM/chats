import { prisma } from "@/server/db/client";

/**
 * Opciones de "servicio de interés" de una organización, ordenadas como se
 * muestran en los <select>. Reemplaza a SERVICES (lib/pipeline.ts), que era
 * una lista fija global -- mismo patrón que getOrgStages() en
 * server/services/pipeline.ts.
 */
export async function getOrgServices(organizationId: string): Promise<{ id: string; label: string }[]> {
  const services = await prisma.service.findMany({
    where: { organizationId },
    orderBy: { order: "asc" },
    select: { id: true, label: true },
  });
  return services;
}
