import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { encrypt } from "@/lib/crypto";
import { isMarketingEnabled } from "@/lib/features";
import { getPlatformSettings } from "@/server/services/platform-settings";
import { exchangeEmbeddedSignupCode } from "@/server/services/whatsapp";
import { listAdAccounts } from "@/server/services/meta-ads";

const bodySchema = z.object({ code: z.string().min(1) });

// Recibe el "code" del FB.login() de "Conectar con Facebook" (ads_read), lo
// canjea por token en el servidor -- el token nunca toca el navegador -- y
// lo guarda cifrado en la organización. Si la persona autorizó una sola
// cuenta publicitaria queda elegida; si autorizó varias, el cliente muestra
// la lista y llama a selectMetaAdAccountAction.
export async function POST(req: NextRequest) {
  if (!isMarketingEnabled()) return NextResponse.json({ error: "No disponible" }, { status: 404 });

  const session = await auth();
  if (!session?.user?.organizationId || session.user.role !== "OWNER") {
    return NextResponse.json({ error: "Solo el dueño de la organización puede conectar Meta Ads" }, { status: 403 });
  }
  const organizationId = session.user.organizationId;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  try {
    const settings = await getPlatformSettings();
    if (!settings.whatsappAppId || !settings.whatsappAppSecret) {
      return NextResponse.json({ error: "Falta configurar la app de Meta en /admin/settings." }, { status: 500 });
    }

    const { accessToken, expiresIn } = await exchangeEmbeddedSignupCode({
      code: body.code,
      appId: settings.whatsappAppId,
      appSecret: settings.whatsappAppSecret,
    });

    const accounts = await listAdAccounts(accessToken);
    if (accounts.length === 0) {
      return NextResponse.json(
        { error: "Meta no devolvió ninguna cuenta publicitaria. Marcá una cuenta al autorizar." },
        { status: 400 },
      );
    }

    const only = accounts.length === 1 ? accounts[0] : null;
    await prisma.organization.update({
      where: { id: organizationId },
      data: {
        metaAdsAccessToken: encrypt(accessToken),
        metaAdsTokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        metaAdsConnectedAt: new Date(),
        metaAdAccountId: only?.id ?? null,
        metaAdAccountName: only?.name ?? null,
        metaAdsLastSyncedAt: null,
      },
    });

    return NextResponse.json({ error: null, accounts: only ? [] : accounts, selected: only });
  } catch (error) {
    console.error("[meta-ads] Error completando la conexión:", error);
    return NextResponse.json({ error: "No se pudo completar la conexión con Meta." }, { status: 500 });
  }
}
