import type { ServerEnv } from "./env.ts";

export interface RedisConfig {
  url: string;
}

export function redisConfig(env: ServerEnv): RedisConfig {
  return { url: env.REDIS_URL };
}
