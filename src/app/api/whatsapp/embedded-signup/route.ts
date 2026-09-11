import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotOwnerAccess } from "@/server/auth/guards";
import { encrypt } from "@/lib/crypto";
import { getPlatformSettings } from "@/server/services/platform-settings";
import {
  exchangeEmbeddedSignupCode,
  subscribeAppToWaba,
  verifyPhoneNumber,
  getWabaPhoneNumbers,
  initiateSmbAppDataSync,
} from "@/server/services/whatsapp";
import { enqueueOrReschedule } from "@/server/jobs";

// El "compartir tus chats" que confirma la pantalla del celular es un paso
// async del lado del celular (mensaje de "Cuenta de Facebook Empresas" +
// confirmación) que puede tardar más que este request web. Pedir el
// historial recién a los pocos minutos, no al instante, evita pedirlo antes
// de que esa confirmación llegue -- Meta solo deja pedirlo una vez por
// conexión, así que si se pide demasiado pronto no hay forma de reintentar
// sin desconectar y reconectar todo de cero (confirmado en producción).
const HISTORY_SYNC_DELAY_MS = 3 * 60_000;

const bodySchema = z.object({
  code: z.string().min(1),
  wabaId: z.string().min(1),
  // El evento de finalización de Coexistence ("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")
  // puede no traer phone_number_id -- ver embedded-signup-button.tsx. Si
  // falta, se resuelve más abajo consultando los números de la WABA.
  phoneNumberId: z.string().min(1).optional(),
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
    const settings = await getPlatformSettings();
    if (!settings.whatsappAppId || !settings.whatsappAppSecret) {
      return NextResponse.json(
        { error: "Faltan WHATSAPP_APP_ID/WHATSAPP_APP_SECRET. Configúralos en Configuración (admin)." },
        { status: 500 },
      );
    }

    const { accessToken } = await exchangeEmbeddedSignupCode({
      code: body.code,
      appId: settings.whatsappAppId,
      appSecret: settings.whatsappAppSecret,
    });

    let phoneNumberId = body.phoneNumberId;
    if (!phoneNumberId) {
      const numbers = await getWabaPhoneNumbers({ wabaId: body.wabaId, accessToken });
      if (numbers.length === 0) {
        return NextResponse.json(
          { error: "Meta no devolvió ningún número para esa cuenta de WhatsApp Business." },
          { status: 500 },
        );
      }
      if (numbers.length > 1) {
        return NextResponse.json(
          {
            error:
              "Esa cuenta de WhatsApp Business tiene varios números y Meta no indicó cuál conectar. Contactá a soporte.",
          },
          { status: 500 },
        );
      }
      phoneNumberId = numbers[0].id;
    }

    const [{ displayNumber }] = await Promise.all([
      verifyPhoneNumber({ phoneNumberId, accessToken }),
      subscribeAppToWaba({ wabaId: body.wabaId, accessToken }),
    ]);

    const connection = await prisma.whatsAppConnection.upsert({
      where: { botId: body.botId },
      create: {
        botId: body.botId,
        phoneNumberId,
        wabaId: body.wabaId,
        displayNumber,
        accessToken: encrypt(accessToken),
        verified: true,
        coexistence: true,
        historySyncStatus: "PENDING",
      },
      update: {
        phoneNumberId,
        wabaId: body.wabaId,
        displayNumber,
        accessToken: encrypt(accessToken),
        verified: true,
        coexistence: true,
        historySyncStatus: "PENDING",
      },
    });

    // Sin esto, Meta nunca manda los webhooks de contactos/historial, sin
    // importar que la app esté suscrita a esos campos -- hay que pedirlos
    // explícitamente, dentro de las primeras 24h de conectar (doc de
    // Coexistence). Contactos se pide ya mismo (no depende de ninguna
    // confirmación del celular); el historial se encola con demora -- ver
    // el comentario de HISTORY_SYNC_DELAY_MS más arriba.
    try {
      await initiateSmbAppDataSync({ phoneNumberId, accessToken, syncType: "smb_app_state_sync" });
    } catch (error) {
      console.error("[embedded-signup] No se pudo iniciar la sincronización de contactos:", error);
    }

    // enqueueOrReschedule (no enqueue) a propósito: si esto es una
    // reconexión (mismo botId, mismo connection.id que un intento previo),
    // tiene que volver a correr sí o sí -- enqueue() se callaría en
    // silencio por el uniqueKey duplicado, dejando el reintento sin pedir
    // nada nuevo.
    await enqueueOrReschedule({
      type: "coexistence_history_sync",
      uniqueKey: `coexistence_history_sync:${connection.id}`,
      payload: { connectionId: connection.id },
      runAfter: new Date(Date.now() + HISTORY_SYNC_DELAY_MS),
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
