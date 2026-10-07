import type { LogLevel, ServerEnv } from "./env.ts";

export interface AppConfig {
  env: ServerEnv["NODE_ENV"];
  isProduction: boolean;
  logLevel: LogLevel;
  apiPort: number;
  corsOrigins: string[];
  trustProxy: boolean | number | string;
  webAppUrl: string;
  /** Origins allowed to make state-changing requests (CSRF protection). */
  allowedOrigins: string[];
}

export function appConfig(env: ServerEnv): AppConfig {
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    logLevel: env.LOG_LEVEL,
    apiPort: env.API_PORT,
    corsOrigins: env.API_CORS_ORIGINS,
    trustProxy: env.API_TRUST_PROXY,
    webAppUrl: env.WEB_APP_URL.replace(/\/$/, ""),
    allowedOrigins: [...new Set([new URL(env.WEB_APP_URL).origin, ...env.API_CORS_ORIGINS])],
  };
}
