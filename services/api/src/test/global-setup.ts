import { execFileSync } from "node:child_process";
import { Redis } from "ioredis";
import { integrationTestEnv, repoRoot } from "./test-env.ts";

/**
 * Applies pending migrations to the test database (creating it if needed) and checks Redis.
 * Uses the non-destructive `migrate deploy`; tests clean up with TRUNCATE in `TestApp.reset`.
 */
export default async function setup(): Promise<void> {
  const env = integrationTestEnv();
  const unavailable = "Integration tests need PostgreSQL and Redis. Start them with `pnpm infra:up`.";

  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: "pipe",
      shell: process.platform === "win32",
    });
  } catch (error) {
    const output = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
    throw new Error(`${unavailable}\n${output}`);
  }

  const redis = new Redis(env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    throw new Error(unavailable);
  } finally {
    redis.disconnect();
  }
}
