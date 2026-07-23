import "dotenv/config";
import { Worker } from "bullmq";
import { processGenerationJob } from "./jobs/process-generation.job.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

new Worker("generations", processGenerationJob, {
  connection: { url: redisUrl }
});

console.log("angel-ai-studio-worker listening for generation jobs");
