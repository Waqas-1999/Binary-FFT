import type { ServerEnv } from "./env.ts";

export interface TelegramConfig {
  /** Server-only. Never sent to browsers or logged. */
  botToken: string;
  /** Without the "@"; used to build the deep link the browser opens. */
  botUsername: string;
  /** Telegram echoes this in `X-Telegram-Bot-Api-Secret-Token` on every webhook call. Server-only. */
  webhookSecret: string;
}

/** Returns the Telegram bot settings, or undefined when the integration is not configured. */
export function telegramConfig(env: ServerEnv): TelegramConfig | undefined {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_USERNAME || !env.TELEGRAM_WEBHOOK_SECRET) return undefined;
  return {
    botToken: env.TELEGRAM_BOT_TOKEN,
    botUsername: env.TELEGRAM_BOT_USERNAME.replace(/^@/, ""),
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
  };
}
