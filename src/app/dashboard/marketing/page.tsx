import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { getOrgServices } from "@/server/services/services-catalog";
import { getOrgMemberUserIds } from "@/server/services/organization-membership";
import { MarketingClient } from "./_components/marketing-client";
import { isMarketingEnabled } from "@/lib/features";

export default async function MarketingPage() {
  if (!isMarketingEnabled()) redirect("/dashboard");
  const session = await auth();
  if (!session?.user.organizationId) redirect("/login");

  const organizationId = session.user.organizationId;

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { metaAdAccountId: true },
  });

  if (!org.metaAdAccountId) {
    return (
      <div className="max-w-lg animate-fade-up">
        <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Marketing</h1>
        <p className="mb-8 text-sm text-ink-muted">Embudo comercial conectado al gasto de Meta Ads.</p>
        <Card>
          <CardTitle className="mb-1">Todavía no hay cuenta publicitaria conectada</CardTitle>
          <CardDescription className="mb-4">
            Cargá el ID de tu cuenta de Meta Ads (formato act_XXXXXXXXX) en Organización para que
            empiece a sincronizarse el gasto — se sincroniza sola cada ~20h una vez configurada.
          </CardDescription>
          {session.user.role === "OWNER" && (
            <Link href="/dashboard/organization" className="text-sm text-accent hover:underline">
              Ir a Organización →
            </Link>
          )}
        </Card>
      </div>
    );
  }

  const [members, sourcesRaw, services, citiesRaw, adRows] = await Promise.all([
    getOrgMemberUserIds(organizationId).then((ids) =>
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    ),
    prisma.contact.findMany({
      where: { organizationId, source: { not: null } },
      select: { source: true },
      distinct: ["source"],
    }),
    getOrgServices(organizationId),
    prisma.contact.findMany({
      where: { organizationId, city: { not: null } },
      select: { city: true },
      distinct: ["city"],
    }),
    prisma.adSpendSnapshot.findMany({
      where: { organizationId },
      select: { campaignId: true, campaignName: true, adsetId: true, adsetName: true, adId: true, adName: true },
      distinct: ["adId"],
    }),
  ]);

  const campaigns = [...new Map(adRows.map((r) => [r.campaignId, r.campaignName])).entries()];
  const adsets = [...new Map(adRows.map((r) => [r.adsetId, r.adsetName])).entries()];
  const ads = [...new Map(adRows.map((r) => [r.adId, r.adName])).entries()];

  return (
    <MarketingClient
      members={members.map((m) => ({ id: m.id, name: m.name || m.email }))}
      sources={sourcesRaw.map((s) => s.source!).filter(Boolean)}
      services={services.map((s) => s.label)}
      cities={citiesRaw.map((c) => c.city!).filter(Boolean)}
      campaigns={campaigns.map(([id, name]) => ({ id, name }))}
      adsets={adsets.map(([id, name]) => ({ id, name }))}
      ads={ads.map(([id, name]) => ({ id, name }))}
    />
  );
}
