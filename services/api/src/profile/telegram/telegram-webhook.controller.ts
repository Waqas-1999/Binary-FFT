import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiError } from "../../common/api-error.ts";
import { SkipOriginCheck } from "../../common/origin.guard.ts";
import { TelegramService } from "./telegram.service.ts";

/**
 * Receives updates from Telegram. It has no cookie or browser origin; the shared secret Telegram sends
 * in `X-Telegram-Bot-Api-Secret-Token` (set when the webhook is registered) is the only credential, and
 * nothing in the body is trusted to say who the BINERY user is.
 */
@Controller("telegram")
export class TelegramWebhookController {
  constructor(private readonly telegram: TelegramService) {}

  @Post("webhook")
  @SkipOriginCheck()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() body: unknown,
    @Headers("x-telegram-bot-api-secret-token") secret: string | undefined,
  ): Promise<{ ok: true }> {
    // Not configured looks exactly like a route that doesn't exist; a wrong secret reveals nothing.
    if (!this.telegram.available) throw new ApiError(HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found");
    if (!this.telegram.isWebhookAuthentic(secret)) throw new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", "Forbidden");

    await this.telegram.handleUpdate(body);
    return { ok: true };
  }
}
