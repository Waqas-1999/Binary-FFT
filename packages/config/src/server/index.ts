// Server-only configuration. Never import this module from browser code:
// it reads secrets such as DATABASE_URL from the environment.
import { appConfig, type AppConfig } from "./app.ts";
import { databaseConfig, type DatabaseConfig } from "./database.ts";
import { emailConfig, type SmtpConfig } from "./email.ts";
import { parseServerEnv } from "./env.ts";
import { googleOAuthConfig, type GoogleOAuthConfig } from "./google.ts";
import { redisConfig, type RedisConfig } from "./redis.ts";
import { securityConfig, type SecurityConfig } from "./security.ts";
import { telegramConfig, type TelegramConfig } from "./telegram.ts";

export type { AppConfig, DatabaseConfig, GoogleOAuthConfig, RedisConfig, SecurityConfig, TelegramConfig };
export type { SmtpConfig } from "./email.ts";
export type { LogLevel } from "./env.ts";

export interface ServerConfig {
  app: AppConfig;
  database: DatabaseConfig;
  email: { smtp: SmtpConfig | undefined };
  /** Undefined when Google sign-in is not configured. */
  google: GoogleOAuthConfig | undefined;
  redis: RedisConfig;
  security: SecurityConfig;
  /** Undefined when the Telegram integration is not configured. */
  telegram: TelegramConfig | undefined;
}

export function loadServerConfig(source: NodeJS.ProcessEnv = process.env): ServerConfig {
  const env = parseServerEnv(source);
  return {
    app: appConfig(env),
    database: databaseConfig(env),
    email: { smtp: emailConfig(env) },
    google: googleOAuthConfig(env),
    redis: redisConfig(env),
    security: securityConfig(env),
    telegram: telegramConfig(env),
  };
}
