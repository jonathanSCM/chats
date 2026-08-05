// Service worker: recibe las notificaciones push aunque la app esté cerrada
// y abre la conversación correspondiente al tocarlas.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "WhatsApp ProShop", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "WhatsApp ProShop", {
      body: payload.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Un tag por conversación: los mensajes nuevos del mismo chat
      // reemplazan la notificación anterior en vez de apilarse.
      tag: payload.conversationId ?? "general",
      renotify: true,
      // Sin esto, Windows la retira del Action Center a los pocos segundos
      // si no hay interacción — se queda hasta que alguien la toca o cierra.
      requireInteraction: true,
      data: { conversationId: payload.conversationId },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = "/dashboard/inbox";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Si ya hay una ventana abierta, se enfoca en vez de abrir otra.
      for (const client of clients) {
        if (client.url.includes("/dashboard") && "focus" in client) {
          client.focus();
          client.postMessage({
            type: "OPEN_CONVERSATION",
            conversationId: event.notification.data?.conversationId,
          });
          return;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
