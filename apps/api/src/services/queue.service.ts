import { Queue } from "bullmq";
import { env } from "../config/env.js";

let generationQueue: Queue | undefined;

function getGenerationQueue() {
  generationQueue ??= new Queue("generations", {
    connection: { url: env.redisUrl }
  });

  return generationQueue;
}

export async function enqueueGeneration(generationId: string) {
  if (process.env.NODE_ENV === "test" || process.env.ENABLE_QUEUE !== "true") {
    return;
  }

  await getGenerationQueue().add("process-generation", { generationId }, { attempts: 3, backoff: { type: "exponential", delay: 5000 } });
}
