"use client";

import { useCallback, useEffect, useState } from "react";

// El navegador espera la llave VAPID como Uint8Array, no como el base64url
// que devuelve el servidor.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type PushStatus = "unsupported" | "denied" | "prompt" | "enabled";

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>("prompt");

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined";

  // Registra el SW al montar; sin él no hay notificaciones con la app cerrada.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!supported) {
        if (!cancelled) setStatus("unsupported");
        return;
      }

      try {
        await navigator.serviceWorker.register("/sw.js");
      } catch (error) {
        console.error("[push] No se pudo registrar el service worker:", error);
      }

      if (cancelled) return;
      if (Notification.permission === "denied") setStatus("denied");
      else if (Notification.permission === "granted") setStatus("enabled");
      else setStatus("prompt");
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  // Suscribe este dispositivo. Se llama desde un gesto del usuario: iOS
  // rechaza requestPermission() fuera de una interacción directa.
  const subscribe = useCallback(async () => {
    if (!supported) return;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus(permission === "denied" ? "denied" : "prompt");
      return;
    }

    try {
      const keyRes = await fetch("/api/push/vapid-key");
      const { publicKey } = (await keyRes.json()) as { publicKey: string | null };
      if (!publicKey) {
        console.warn("[push] VAPID_PUBLIC_KEY no está configurada en el servidor.");
        setStatus("enabled"); // las notificaciones en primer plano igual funcionan
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        }));

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      setStatus("enabled");
    } catch (error) {
      console.error("[push] No se pudo suscribir:", error);
    }
  }, [supported]);

  return { status, subscribe };
}
