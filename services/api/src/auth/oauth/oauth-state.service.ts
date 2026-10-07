import { Injectable, Logger } from "@nestjs/common";
import { generateToken, hashToken } from "../tokens.ts";
import { RedisService } from "../../redis/redis.service.ts";

export type OAuthStateType = "login" | "link";

export interface OAuthState {
  state: string;
  stateHash: string;
  expiresAt: Date;
}

/**
 * Short-lived, single-use OAuth state. Stored in Redis so it is:
 * - cryptographically random (256-bit)
 * - bound to the browser/session that initiated the flow
 * - single-use: consumed on the first callback
 * - short-lived: 1 hour
 */
@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name);
  private readonly prefix = "oauth-state:";

  constructor(private readonly redis: RedisService) {}

  /** Creates and stores a new state value for the given type and optional userId. */
  async create(type: OAuthStateType, userId?: string): Promise<string> {
    const state = generateToken();
    const stateHash = hashToken(state);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const value = JSON.stringify({ type, userId: userId ?? null, expiresAt: expiresAt.toISOString() });
    await this.redis.client.set(`${this.prefix}${stateHash}`, value, "EX", 60 * 60);
    return state;
  }

  /**
   * Validates and consumes the state. Returns the parsed state data if valid.
   * Throws if the state is unknown, expired, already consumed, or has a type mismatch.
   */
  async consume(state: string, expectedType: OAuthStateType, expectedUserId?: string): Promise<{ type: OAuthStateType; userId: string | null }> {
    const stateHash = hashToken(state);
    const key = `${this.prefix}${stateHash}`;
    const stored = await this.redis.client.get(key);
    if (!stored) {
      throw new Error("Invalid or consumed OAuth state");
    }

    // Single-use: delete immediately before processing
    await this.redis.client.del(key);

    const data = JSON.parse(stored) as { type: OAuthStateType; userId: string | null; expiresAt: string };

    if (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now()) {
      throw new Error("Expired OAuth state");
    }
    if (data.type !== expectedType) {
      throw new Error("OAuth state type mismatch");
    }
    if (expectedUserId && data.userId !== expectedUserId) {
      throw new Error("OAuth state user mismatch");
    }

    return { type: data.type, userId: data.userId };
  }

  /** Best-effort cleanup of stale state entries. Never throws. */
  async cleanup(): Promise<void> {
    try {
      const keys = await this.redis.client.keys(`${this.prefix}*`);
      if (keys.length > 0) await this.redis.client.del(keys);
    } catch (error) {
      this.logger.warn(`OAuth state cleanup failed: ${error}`);
    }
  }
}