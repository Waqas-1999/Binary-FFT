import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * Integration tests use the dev services from `pnpm infra:up` but isolated stores:
 * the `<db>_test` database and Redis logical database 15. Dev data is never touched.
 */
export function integrationTestEnv(): Record<string, string> {
  const envFile = `${repoRoot}.env`;
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
    throw new Error("Integration tests need DATABASE_URL and REDIS_URL (copy .env.example to .env).");
  }

  const database = new URL(process.env.DATABASE_URL);
  if (!database.pathname.endsWith("_test")) database.pathname = `${database.pathname}_test`;
  const redis = new URL(process.env.REDIS_URL);
  redis.pathname = "/15";

  return {
    NODE_ENV: "test",
    DATABASE_URL: database.toString(),
    REDIS_URL: redis.toString(),
    WEB_APP_URL: "http://localhost:3000",
    API_CORS_ORIGINS: "",
    LOG_LEVEL: "log",
  };
}
