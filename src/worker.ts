import { Worker } from "bullmq";
import { redisConnection } from "@/server/queue/connection";
import { WHATSAPP_INBOUND_QUEUE, type WhatsAppInboundJob } from "@/server/queue/whatsapp-inbound.queue";
import { handleIncomingMessage } from "@/server/services/conversation";

const worker = new Worker<WhatsAppInboundJob>(
  WHATSAPP_INBOUND_QUEUE,
  async (job) => {
    await handleIncomingMessage(job.data);
  },
  { connection: redisConnection, concurrency: 10 },
);

worker.on("completed", (job) => {
  console.log(`[whatsapp-inbound] job ${job.id} completado`);
});

worker.on("failed", (job, err) => {
  console.error(`[whatsapp-inbound] job ${job?.id} falló:`, err);
});

console.log("Worker de whatsapp-inbound escuchando...");
