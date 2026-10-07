import type { ServerEnv } from "./env.ts";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  from: string;
}

export function emailConfig(env: ServerEnv): SmtpConfig | undefined {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return undefined;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER && env.SMTP_PASSWORD ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    from: env.SMTP_FROM,
  };
}
