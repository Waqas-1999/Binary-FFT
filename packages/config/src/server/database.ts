import type { ServerEnv } from "./env.ts";

export interface DatabaseConfig {
  url: string;
}

export function databaseConfig(env: ServerEnv): DatabaseConfig {
  return { url: env.DATABASE_URL };
}
