import { Job } from "bullmq";
import { runMockProvider } from "../providers/mock.provider.js";

export async function processGenerationJob(job: Job<{ generationId: string }>) {
  const result = await runMockProvider(job.data.generationId);
  console.log("generation completed", result);
  return result;
}
