import { describe, expect, it } from "vitest";
import type { PrismaService } from "../database/prisma.service.ts";
import type { RedisService } from "../redis/redis.service.ts";
import { HealthService } from "./health.service.ts";

function createService(database: () => Promise<unknown>, redis: () => Promise<void>) {
  const prisma = { $queryRaw: database } as unknown as PrismaService;
  const redisService = { ping: redis } as unknown as RedisService;
  return new HealthService(prisma, redisService);
}

describe("HealthService", () => {
  it("reports ok when every dependency responds", async () => {
    const service = createService(
      async () => [],
      async () => undefined,
    );

    const result = await service.check();

    expect(result.status).toBe("ok");
    expect(result.checks).toEqual({ database: "up", redis: "up" });
  });

  it("reports degraded when a dependency fails", async () => {
    const service = createService(
      async () => [],
      async () => {
        throw new Error("connection refused");
      },
    );

    const result = await service.check();

    expect(result.status).toBe("degraded");
    expect(result.checks).toEqual({ database: "up", redis: "down" });
  });
});
