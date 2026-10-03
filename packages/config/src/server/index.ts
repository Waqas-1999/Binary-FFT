// Server-only configuration. Never import this module from browser code:
// it reads secrets such as DATABASE_URL from the environment.
import { appConfig, type AppConfig } from "./app.ts";
import { databaseConfig, type DatabaseConfig } from "./database.ts";
import { parseServerEnv } from "./env.ts";
import { redisConfig, type RedisConfig } from "./redis.ts";

export type { AppConfig, DatabaseConfig, RedisConfig };
export type { LogLevel } from "./env.ts";

export interface ServerConfig {
  app: AppConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
}

export function loadServerConfig(source: NodeJS.ProcessEnv = process.env): ServerConfig {
  const env = parseServerEnv(source);
  return {
    app: appConfig(env),
    database: databaseConfig(env),
    redis: redisConfig(env),
  };
}
