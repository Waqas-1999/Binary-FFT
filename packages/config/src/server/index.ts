// Server-only configuration. Never import this module from browser code:
// it reads secrets such as DATABASE_URL from the environment.
import { appConfig, type AppConfig } from "./app.ts";
import { databaseConfig, type DatabaseConfig } from "./database.ts";
import { emailConfig, type SmtpConfig } from "./email.ts";
import { parseServerEnv } from "./env.ts";
import { googleOAuthConfig, type GoogleOAuthConfig } from "./google.ts";
import { redisConfig, type RedisConfig } from "./redis.ts";

export type { AppConfig, DatabaseConfig, GoogleOAuthConfig, RedisConfig };
export type { SmtpConfig } from "./email.ts";
export type { LogLevel } from "./env.ts";

export interface ServerConfig {
  app: AppConfig;
  database: DatabaseConfig;
  email: { smtp: SmtpConfig | undefined };
  /** Undefined when Google sign-in is not configured. */
  google: GoogleOAuthConfig | undefined;
  redis: RedisConfig;
}

export function loadServerConfig(source: NodeJS.ProcessEnv = process.env): ServerConfig {
  const env = parseServerEnv(source);
  return {
    app: appConfig(env),
    database: databaseConfig(env),
    email: { smtp: emailConfig(env) },
    google: googleOAuthConfig(env),
    redis: redisConfig(env),
  };
}
