import { Module } from "@nestjs/common";
import type { ServerConfig } from "@repo/config/server";
import { AuthModule } from "../auth/auth.module.ts";
import { SERVER_CONFIG } from "../config/config.module.ts";
import { MobileService } from "./mobile.service.ts";
import { NotificationPreferencesService } from "./notification-preferences.service.ts";
import { NotificationsController } from "./notifications.controller.ts";
import { ProfileController } from "./profile.controller.ts";
import { ProfileService } from "./profile.service.ts";
import { SMS_PROVIDER, UnavailableSmsProvider } from "./sms/sms.provider.ts";
import { HttpTelegramClient, TELEGRAM_CLIENT } from "./telegram/telegram.client.ts";
import { TelegramService } from "./telegram/telegram.service.ts";
import { TelegramWebhookController } from "./telegram/telegram-webhook.controller.ts";

/** Profile, optional mobile number, Telegram connection and notification preferences. */
@Module({
  imports: [AuthModule],
  controllers: [ProfileController, NotificationsController, TelegramWebhookController],
  providers: [
    MobileService,
    NotificationPreferencesService,
    ProfileService,
    TelegramService,
    // Register a real SMS gateway adapter here; until one exists mobile verification reports "unavailable".
    { provide: SMS_PROVIDER, useClass: UnavailableSmsProvider },
    {
      // Null when Telegram is not configured; the service then reports "unavailable".
      provide: TELEGRAM_CLIENT,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) => (config.telegram ? new HttpTelegramClient(config.telegram) : null),
    },
  ],
  exports: [NotificationPreferencesService],
})
export class ProfileModule {}
