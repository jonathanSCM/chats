import { prisma } from "@/server/db/client";
import { decrypt } from "@/lib/crypto";
import { initiateSmbAppDataSync } from "@/server/services/whatsapp";

/**
 * Pide el historial de Coexistence unos minutos después de conectar, no al
 * instante. El "compartir tus chats" que confirma la pantalla del celular
 * (ver doc "Registrar usuarios de la app de WhatsApp Business") es un paso
 * async del lado del celular que puede tardar más que el request web que
 * termina el Embedded Signup -- pedirlo en el mismo request, como se hacía
 * antes, corría el riesgo real de llegar antes de que esa confirmación
 * pasara, y Meta respondía "History sync is turned off" (2593109) aunque la
 * persona SÍ hubiera elegido compartir, solo que todavía no a tiempo. Esto
 * solo se puede pedir una vez por conexión (Meta no deja reintentar sin
 * desconectar y reconectar de cero), así que vale la pena este margen.
 */
export async function handleCoexistenceHistorySync(payload: unknown): Promise<void> {
  const { connectionId } = payload as { connectionId: string };

  const connection = await prisma.whatsAppConnection.findUnique({ where: { id: connectionId } });
  if (!connection || !connection.coexistence) return;

  const accessToken = decrypt(connection.accessToken);
  await initiateSmbAppDataSync({
    phoneNumberId: connection.phoneNumberId,
    accessToken,
    syncType: "history",
  });
}
