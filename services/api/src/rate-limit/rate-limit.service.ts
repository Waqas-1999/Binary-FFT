import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { toErrorMessage } from "@repo/utils";
import { createHash } from "node:crypto";
import { ApiError, RateLimitedException } from "../common/api-error.ts";
import { RedisService } from "../redis/redis.service.ts";

export interface RateLimit {
  /** Maximum hits per window. */
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window counters in Redis. Fails closed: if Redis is unavailable, limited actions are
 * refused (503) rather than left unprotected.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(private readonly redis: RedisService) {}

  /** Counts a hit and throws `RateLimitedException` once the limit is exceeded. */
  async consume(key: string, rule: RateLimit): Promise<void> {
    const { count, ttl } = await this.hit(key, rule);
    if (count > rule.limit) throw new RateLimitedException(ttl);
  }

  /** Counts a hit; returns false once the limit is exceeded. For limits that must stay silent. */
  async tryConsume(key: string, rule: RateLimit): Promise<boolean> {
    const { count } = await this.hit(key, rule);
    return count <= rule.limit;
  }

  /** Throws if the key has already reached its limit, without counting a hit. */
  async assertAvailable(key: string, rule: RateLimit): Promise<void> {
    const [count, ttl] = await this.run(async () => {
      const result = await this.redis.client.multi().get(this.key(key)).ttl(this.key(key)).exec();
      return [Number(result?.[0]?.[1] ?? 0), Number(result?.[1]?.[1] ?? 0)] as const;
    });
    if (count >= rule.limit) throw new RateLimitedException(Math.max(ttl, 1));
  }

  async hit(key: string, rule: RateLimit): Promise<{ count: number; ttl: number }> {
    return this.run(async () => {
      const redisKey = this.key(key);
      const result = await this.redis.client
        .multi()
        .incr(redisKey)
        .expire(redisKey, rule.windowSeconds, "NX")
        .ttl(redisKey)
        .exec();
      const error = result?.find(([err]) => err)?.[0];
      if (!result || error) throw error ?? new Error("Rate limit transaction aborted");
      return { count: Number(result[0]?.[1]), ttl: Math.max(Number(result[2]?.[1]), 1) };
    });
  }

  private key(key: string): string {
    return `rl:${key}`;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger.error(`Rate limiter unavailable: ${toErrorMessage(error)}`);
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", "Service temporarily unavailable");
    }
  }
}

/** Hashes identifiers such as emails so they never appear in Redis keys. */
export function rateLimitId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
