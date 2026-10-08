import type { TelegramConfig } from "@repo/config/server";

/** The one thing the platform asks of Telegram: send a plain-text message to a chat. */
export interface TelegramClient {
  sendMessage(chatId: string, text: string): Promise<void>;
}

export const TELEGRAM_CLIENT = Symbol("TELEGRAM_CLIENT");

/** Talks to the Telegram Bot API. The bot token is part of the request URL, so errors are rewritten before they escape. */
export class HttpTelegramClient implements TelegramClient {
  constructor(private readonly config: TelegramConfig) {}

  async sendMessage(chatId: string, text: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // The original error can include the request URL, and with it the bot token.
      throw new Error("Telegram sendMessage failed: network error");
    }
    if (!response.ok) throw new Error(`Telegram sendMessage failed: HTTP ${response.status}`);
  }
}
