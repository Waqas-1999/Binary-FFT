import { type Processor, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { logger } from "./logger.ts";

/** Queue name → job processor. Phase 0 defines no jobs; register processors here as they are added. */
const processors: Record<string, Processor> = {};

export function startWorkers(connection: Redis): Worker[] {
  return Object.entries(processors).map(([queue, processor]) => {
    const worker = new Worker(queue, processor, { connection });
    worker.on("failed", (job, error) => {
      logger.error("Job failed", { queue, jobId: job?.id, error: error.message });
    });
    return worker;
  });
}
