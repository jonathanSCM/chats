import "dotenv/config";
import { Worker } from "bullmq";
import { getWhatsappInboundQueue } from "./whatsapp-inbound.queue";
import { redisConnection } from "./connection";
import { handleIncomingMessage } from "@/server/services/conversation";

async function startWorker() {
  await redisConnection.connect();

  const worker = new Worker(
    "whatsapp-inbound",
    async (job) => {
      console.log(`[Worker] Procesando mensaje ${job.data.messageId} de ${job.data.customerPhone}`);
      try {
        await handleIncomingMessage(job.data);
        return { success: true };
      } catch (error) {
        console.error(`[Worker] Error procesando ${job.data.messageId}:`, error);
        throw error;
      }
    },
    { connection: redisConnection },
  );

  worker.on("completed", (job) => {
    console.log(`[Worker] ✅ Completado: ${job.id}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Worker] ❌ Falló ${job?.id}:`, err?.message);
  });

  console.log("[Worker] 🚀 Escuchando cola whatsapp-inbound...");
}

startWorker().catch((err) => {
  console.error("[Worker] Error fatal:", err);
  process.exit(1);
});
