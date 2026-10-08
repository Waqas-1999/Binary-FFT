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

  // The database proxy can be slow to answer the first connection while a full `pnpm test` is also starting
  // every CPU-heavy browser-environment suite, so an unreachable server is retried a few times before
  // giving up. Any other failure (a bad migration, say) is reported immediately.
  const attempts = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
        cwd: repoRoot,
        env: { ...process.env, ...env },
        stdio: "pipe",
        shell: process.platform === "win32",
      });
      break;
    } catch (error) {
      const output = (error as { stderr?: Buffer; stdout?: Buffer }).stderr?.toString() ?? "";
      const unreachable = /P1001|P1002|P1017/.test(output + ((error as { stdout?: Buffer }).stdout?.toString() ?? ""));
      if (!unreachable || attempt === attempts) throw new Error(`${unavailable}\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
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
