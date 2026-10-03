import type { LogLevel, ServerEnv } from "./env.ts";

export interface AppConfig {
  env: ServerEnv["NODE_ENV"];
  isProduction: boolean;
  logLevel: LogLevel;
  apiPort: number;
  corsOrigins: string[];
}

export function appConfig(env: ServerEnv): AppConfig {
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    logLevel: env.LOG_LEVEL,
    apiPort: env.API_PORT,
    corsOrigins: env.API_CORS_ORIGINS,
  };
}
