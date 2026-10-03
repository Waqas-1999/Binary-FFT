import { loadServerConfig } from "@repo/config/server";
import { toErrorMessage } from "@repo/utils";
import { Redis } from "ioredis";
import { logger } from "./logger.ts";
import { startWorkers } from "./workers.ts";

const config = loadServerConfig();

// BullMQ requires `maxRetriesPerRequest: null` for the blocking connections workers use.
const connection = new Redis(config.redis.url, { maxRetriesPerRequest: null });
connection.on("error", (error: unknown) => logger.warn("Redis error", { error: toErrorMessage(error) }));

await connection.ping();
const workers = startWorkers(connection);
logger.info("Worker started", { workers: workers.length });

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info("Worker shutting down", { signal });
  await Promise.all(workers.map((worker) => worker.close()));
  await connection.quit();
}

process.once("SIGINT", (signal) => void shutdown(signal));
process.once("SIGTERM", (signal) => void shutdown(signal));
