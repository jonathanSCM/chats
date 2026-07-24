import { Queue } from "bullmq";
import { redisConnection } from "./connection";
import type { ParsedInboundMessage } from "@/server/services/whatsapp";

export const WHATSAPP_INBOUND_QUEUE = "whatsapp-inbound";

export type WhatsAppInboundJob = ParsedInboundMessage;

const globalForQueue = globalThis as unknown as {
  whatsappInboundQueue: Queue<WhatsAppInboundJob> | undefined;
};

// Instanciación perezosa: el constructor de Queue conecta a Redis de
// inmediato, y no queremos que eso ocurra al importar el módulo (ej.
// durante el análisis estático que hace `next build` de cada route).
export function getWhatsappInboundQueue(): Queue<WhatsAppInboundJob> {
  if (!globalForQueue.whatsappInboundQueue) {
    globalForQueue.whatsappInboundQueue = new Queue<WhatsAppInboundJob>(
      WHATSAPP_INBOUND_QUEUE,
      {
        connection: redisConnection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 86400 },
        },
      },
    );
  }
  return globalForQueue.whatsappInboundQueue;
}
