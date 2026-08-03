import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotOwnerAccess } from "@/server/auth/guards";
import { encrypt } from "@/lib/crypto";
import {
  exchangeEmbeddedSignupCode,
  subscribeAppToWaba,
  verifyPhoneNumber,
} from "@/server/services/whatsapp";

const bodySchema = z.object({
  code: z.string().min(1),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  botId: z.string().min(1),
});

// Recibe el resultado del FB.login() de Embedded Signup (Coexistence) desde
// el cliente: el "code" (válido 30s), y el waba_id/phone_number_id que Meta
// mandó por postMessage. Termina de armar la conexión del lado del servidor
// — el access token nunca debe tocar el navegador.
export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  try {
    await requireBotOwnerAccess(body.botId);
  } catch {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  try {
    const { accessToken } = await exchangeEmbeddedSignupCode({ code: body.code });

    const [{ displayNumber }] = await Promise.all([
      verifyPhoneNumber({ phoneNumberId: body.phoneNumberId, accessToken }),
      subscribeAppToWaba({ wabaId: body.wabaId, accessToken }),
    ]);

    await prisma.whatsAppConnection.upsert({
      where: { botId: body.botId },
      create: {
        botId: body.botId,
        phoneNumberId: body.phoneNumberId,
        wabaId: body.wabaId,
        displayNumber,
        accessToken: encrypt(accessToken),
        verified: true,
        coexistence: true,
        historySyncStatus: "PENDING",
      },
      update: {
        phoneNumberId: body.phoneNumberId,
        wabaId: body.wabaId,
        displayNumber,
        accessToken: encrypt(accessToken),
        verified: true,
        coexistence: true,
        historySyncStatus: "PENDING",
      },
    });

    return NextResponse.json({ error: null });
  } catch (error) {
    console.error("[embedded-signup] Error completando la conexión:", error);
    return NextResponse.json(
      { error: "No se pudo completar la conexión con Meta. Revisa los logs del servidor." },
      { status: 500 },
    );
  }
}
