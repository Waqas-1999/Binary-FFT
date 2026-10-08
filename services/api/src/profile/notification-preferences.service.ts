import { HttpStatus, Injectable } from "@nestjs/common";
import type { NotificationPreferencesResponse } from "@repo/types";
import { defaultNotificationPreferences, type UpdateNotificationPreferencesInput } from "@repo/validation";
import { AuthEventsService } from "../auth/auth-events.service.ts";
import type { AuthContext } from "../auth/session.service.ts";
import { ApiError } from "../common/api-error.ts";
import type { ClientInfo } from "../common/client-info.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { RateLimitService } from "../rate-limit/rate-limit.service.ts";
import { profileConfig } from "./profile.config.ts";

export type NotificationChannel = "email" | "telegram";
export type NotificationCategory = "security" | "account" | "trading" | "promotions";

/**
 * Per-channel notification choices. Security email is required and cannot be switched off; Telegram only
 * counts while a Telegram account is connected; push does not exist yet.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AuthEventsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async get(userId: string): Promise<NotificationPreferencesResponse> {
    const [row, connection] = await Promise.all([
      this.prisma.userNotificationPreference.findUnique({ where: { userId } }),
      this.prisma.telegramConnection.count({ where: { userId } }),
    ]);
    const defaults = defaultNotificationPreferences;
    return {
      email: {
        security: true,
        account: row?.emailAccount ?? defaults.email.account,
        trading: row?.emailTrading ?? defaults.email.trading,
        promotions: row?.emailPromotions ?? defaults.email.promotions,
      },
      telegram: {
        connected: connection > 0,
        security: row?.telegramSecurity ?? defaults.telegram.security,
        account: row?.telegramAccount ?? defaults.telegram.account,
        trading: row?.telegramTrading ?? defaults.telegram.trading,
        promotions: row?.telegramPromotions ?? defaults.telegram.promotions,
      },
      push: { available: false },
    };
  }

  async update(
    auth: AuthContext,
    input: UpdateNotificationPreferencesInput,
    client: ClientInfo,
  ): Promise<NotificationPreferencesResponse> {
    await this.rateLimit.consume(`notification-prefs:user:${auth.userId}`, profileConfig.rateLimits.notificationPreferencesPerUser);

    if (input.telegram && !(await this.prisma.telegramConnection.count({ where: { userId: auth.userId } }))) {
      throw new ApiError(HttpStatus.CONFLICT, "TELEGRAM_NOT_CONNECTED", "Connect Telegram first");
    }

    const { email = {}, telegram = {} } = input;
    const changes = {
      emailAccount: email.account,
      emailTrading: email.trading,
      emailPromotions: email.promotions,
      telegramSecurity: telegram.security,
      telegramAccount: telegram.account,
      telegramTrading: telegram.trading,
      telegramPromotions: telegram.promotions,
    };
    await this.prisma.userNotificationPreference.upsert({
      where: { userId: auth.userId },
      create: { userId: auth.userId, ...changes },
      update: changes,
      select: { id: true },
    });

    await this.events.record("NOTIFICATION_PREFERENCES_UPDATED", {
      userId: auth.userId,
      sessionId: auth.sessionId,
      client,
      metadata: { email: { ...email }, telegram: { ...telegram } },
    });
    return this.get(auth.userId);
  }

  /**
   * Whether a message of this category may go out on this channel. Senders for account, trading and
   * promotional messages must ask before sending. Security email is always allowed.
   */
  async isAllowed(userId: string, channel: NotificationChannel, category: NotificationCategory): Promise<boolean> {
    if (channel === "email" && category === "security") return true;
    const preferences = await this.get(userId);
    if (channel === "email") return category === "security" ? true : preferences.email[category];
    return preferences.telegram.connected && preferences.telegram[category];
  }
}
