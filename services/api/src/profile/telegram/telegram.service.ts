import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { brand } from "@repo/config";
import type { ServerConfig } from "@repo/config/server";
import type { TelegramLinkResponse } from "@repo/types";
import { toErrorMessage } from "@repo/utils";
import { z } from "@repo/validation";
import { createHash, timingSafeEqual } from "node:crypto";
import { AuthEventsService } from "../../auth/auth-events.service.ts";
import { requireRecentAuth } from "../../auth/recent-auth.ts";
import type { AuthContext } from "../../auth/session.service.ts";
import { generateToken, hashToken } from "../../auth/tokens.ts";
import { ApiError } from "../../common/api-error.ts";
import type { ClientInfo } from "../../common/client-info.ts";
import { SERVER_CONFIG } from "../../config/config.module.ts";
import { PrismaService } from "../../database/prisma.service.ts";
import { Prisma } from "../../generated/prisma/client.js";
import { RateLimitService } from "../../rate-limit/rate-limit.service.ts";
import { profileConfig } from "../profile.config.ts";
import { TELEGRAM_CLIENT, type TelegramClient } from "./telegram.client.ts";

const { telegram, rateLimits } = profileConfig;

/** Link tokens are 32 random bytes, base64url: 43 characters, which also fits Telegram's `start` parameter. */
const START_COMMAND = /^\/start(?:@\w+)?[ \t]+([\w-]{43})$/;

/** The only parts of a Telegram update this platform reads. Anything else is ignored. */
const updateSchema = z.object({
  message: z.object({
    text: z.string().max(4096).optional(),
    from: z.object({ id: z.number().int().positive(), is_bot: z.boolean().optional() }).optional(),
    chat: z.object({ id: z.number().int(), type: z.string() }),
  }),
});

/**
 * Connects a Telegram account to a BINERY user for notifications. Telegram is never a sign-in method.
 * The signed-in session decides who is linking; Telegram's numeric user id (not the username) is the
 * identity; the link token is random, hashed, bound to the user, short-lived and single-use.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AuthEventsService,
    private readonly rateLimit: RateLimitService,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(TELEGRAM_CLIENT) private readonly client: TelegramClient | null,
  ) {}

  /** Whether the bot is configured. Without it the rest of the app runs normally. */
  get available(): boolean {
    return Boolean(this.config.telegram && this.client);
  }

  /** Mints a one-time deep link for the signed-in user. */
  async startLink(auth: AuthContext, client: ClientInfo): Promise<TelegramLinkResponse> {
    const settings = this.config.telegram;
    if (!settings || !this.available) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "FEATURE_UNAVAILABLE", "Telegram is not available");
    }
    requireRecentAuth(auth);
    await this.rateLimit.consume(`telegram-link:user:${auth.userId}`, rateLimits.telegramLinkPerUser);
    if (await this.prisma.telegramConnection.count({ where: { userId: auth.userId } })) {
      throw new ApiError(HttpStatus.CONFLICT, "TELEGRAM_ALREADY_CONNECTED", "Telegram is already connected");
    }

    const token = generateToken();
    const now = new Date();
    await this.prisma.$transaction([
      // Only the newest link works.
      this.prisma.telegramLinkToken.updateMany({ where: { userId: auth.userId, consumedAt: null }, data: { consumedAt: now } }),
      this.prisma.telegramLinkToken.create({
        data: { userId: auth.userId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + telegram.linkTtlSeconds * 1000) },
        select: { id: true },
      }),
    ]);
    await this.events.record("TELEGRAM_LINK_STARTED", { userId: auth.userId, sessionId: auth.sessionId, client });

    return { url: `https://t.me/${settings.botUsername}?start=${token}`, expiresInSeconds: telegram.linkTtlSeconds };
  }

  async disconnect(auth: AuthContext, client: ClientInfo): Promise<void> {
    requireRecentAuth(auth);
    await this.rateLimit.consume(`telegram-unlink:user:${auth.userId}`, rateLimits.telegramUnlinkPerUser);

    const existing = await this.prisma.telegramConnection.findUnique({ where: { userId: auth.userId }, select: { id: true, chatId: true } });
    if (!existing) throw new ApiError(HttpStatus.CONFLICT, "TELEGRAM_NOT_CONNECTED", "Telegram is not connected");

    const removed = await this.prisma.$transaction(async (tx) => {
      await tx.telegramLinkToken.updateMany({ where: { userId: auth.userId, consumedAt: null }, data: { consumedAt: new Date() } });
      return (await tx.telegramConnection.deleteMany({ where: { id: existing.id } })).count;
    });
    if (removed === 0) throw new ApiError(HttpStatus.CONFLICT, "TELEGRAM_NOT_CONNECTED", "Telegram is not connected");

    await this.events.record("TELEGRAM_UNLINKED", { userId: auth.userId, sessionId: auth.sessionId, client });
    await this.reply(existing.chatId, `${brand.name} is no longer connected to this chat. You won't get notifications here.`);
  }

  /** Constant-time check of the secret Telegram sends with every webhook call. */
  isWebhookAuthentic(header: string | undefined): boolean {
    const secret = this.config.telegram?.webhookSecret;
    if (!secret || !header) return false;
    // Hashing first gives both sides the same length, which timingSafeEqual requires.
    return timingSafeEqual(createHash("sha256").update(secret).digest(), createHash("sha256").update(header).digest());
  }

  /**
   * Handles one update from Telegram. Only a private-chat `/start <token>` does anything. The linking
   * user comes from the token's row, never from the message. Expected rejections reply in the chat and
   * return normally (so Telegram doesn't retry); unexpected failures throw so it does.
   */
  async handleUpdate(update: unknown): Promise<void> {
    const parsed = updateSchema.safeParse(update);
    if (!parsed.success) return;
    const { message } = parsed.data;
    if (message.chat.type !== "private" || !message.from || message.from.is_bot) return;

    const token = START_COMMAND.exec(message.text?.trim() ?? "")?.[1];
    if (!token) return;

    const telegramUserId = String(message.from.id);
    const chatId = String(message.chat.id);
    const tokenHash = hashToken(token);

    // Atomic claim: of any number of simultaneous or repeated deliveries, exactly one gets count 1.
    const claimed = await this.prisma.telegramLinkToken.updateMany({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() }, user: { status: "ACTIVE" } },
      data: { consumedAt: new Date() },
    });
    if (claimed.count !== 1) {
      // A retried delivery of a link that already worked shouldn't answer "expired".
      if (!(await this.prisma.telegramConnection.count({ where: { telegramUserId } }))) {
        await this.reply(chatId, `That link has expired or was already used. Open ${brand.name}, go to Profile and choose Connect Telegram again.`);
      }
      return;
    }
    const { userId } = await this.prisma.telegramLinkToken.findUniqueOrThrow({ where: { tokenHash }, select: { userId: true } });

    try {
      await this.prisma.telegramConnection.create({ data: { userId, telegramUserId, chatId }, select: { id: true } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      // The Telegram account (or this user) is already connected. Never transferred, never merged.
      await this.events.record("TELEGRAM_LINK_CONFLICT", { userId });
      await this.reply(chatId, `This Telegram account is already connected to a ${brand.name} account, so it can't be connected again.`);
      return;
    }

    await this.events.record("TELEGRAM_LINKED", { userId });
    await this.reply(chatId, `Connected! This chat will now receive ${brand.name} notifications. You can disconnect any time in Profile.`);
  }

  /** Error text from a client can embed the request URL, which contains the bot token. */
  private redact(text: string): string {
    const settings = this.config.telegram;
    if (!settings) return text;
    const secrets = [settings.botToken, settings.botToken.split(":")[1] ?? "", settings.webhookSecret].filter(Boolean);
    return secrets.reduce((result, secret) => result.replaceAll(secret, "[redacted]"), text);
  }

  /** Best effort: a failed courtesy message must not undo a successful connection. */
  private async reply(chatId: string, text: string): Promise<void> {
    try {
      await this.client?.sendMessage(chatId, text);
    } catch (error) {
      this.logger.warn(`Telegram reply not sent: ${this.redact(toErrorMessage(error))}`);
    }
  }
}
