import webpush from "web-push";
import { prisma } from "@/server/db/client";

let configured = false;

// Las llaves VAPID identifican al servidor ante el push service del navegador.
// Se generan una sola vez con: npx web-push generate-vapid-keys
function ensureConfigured(): boolean {
  if (configured) return true;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@proshop.lat";

  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

interface PushPayload {
  title: string;
  body: string;
  conversationId: string;
}

// Manda la notificación a todos los dispositivos registrados de un usuario.
// Nunca lanza: una notificación fallida no debe tumbar el procesamiento del
// mensaje que la originó.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        // 404/410 = el navegador dio de baja esa suscripción (app desinstalada,
        // permisos revocados, etc.). Se limpia para no reintentar por siempre.
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          return;
        }
        console.error("[push] No se pudo enviar la notificación:", error);
      }
    }),
  );
}

// Notifica sobre un mensaje entrante: al vendedor asignado, o a todo el
// equipo si la conversación todavía no tiene dueño.
export async function notifyNewMessage(params: {
  conversationId: string;
  organizationId: string;
  assignedToId: string | null;
  customerLabel: string;
  preview: string;
}): Promise<void> {
  if (!isPushConfigured()) return;

  const payload: PushPayload = {
    title: params.customerLabel,
    body: params.preview || "Nuevo mensaje",
    conversationId: params.conversationId,
  };

  if (params.assignedToId) {
    await sendPushToUser(params.assignedToId, payload);
    return;
  }

  const team = await prisma.user.findMany({
    where: { organizationId: params.organizationId },
    select: { id: true },
  });
  await Promise.all(team.map((u) => sendPushToUser(u.id, payload)));
}
