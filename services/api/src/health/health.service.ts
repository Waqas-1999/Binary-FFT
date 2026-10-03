import { Injectable, Logger } from "@nestjs/common";
import type { DependencyStatus, HealthResponse } from "@repo/types";
import { toErrorMessage } from "@repo/utils";
import { PrismaService } from "../database/prisma.service.ts";
import { RedisService } from "../redis/redis.service.ts";

const CHECK_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      this.probe("database", () => this.prisma.$queryRaw`SELECT 1`),
      this.probe("redis", () => this.redis.ping()),
    ]);

    return {
      status: database === "up" && redis === "up" ? "ok" : "degraded",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database, redis },
    };
  }

  private async probe(name: string, check: () => Promise<unknown>): Promise<DependencyStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS);
    });

    try {
      await Promise.race([check(), timeout]);
      return "up";
    } catch (error) {
      this.logger.warn(`Health check "${name}" failed: ${toErrorMessage(error)}`);
      return "down";
    } finally {
      clearTimeout(timer);
    }
  }
}
