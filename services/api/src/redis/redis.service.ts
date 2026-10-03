import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { ServerConfig } from "@repo/config/server";
import { toErrorMessage } from "@repo/utils";
import { Redis } from "ioredis";
import { SERVER_CONFIG } from "../config/config.module.ts";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(SERVER_CONFIG) config: ServerConfig) {
    // Fail fast instead of queueing commands while disconnected, so health checks never hang.
    this.client = new Redis(config.redis.url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    this.client.on("error", (error: unknown) => this.logger.warn(`Redis error: ${toErrorMessage(error)}`));
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
