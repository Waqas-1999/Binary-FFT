import { Module } from "@nestjs/common";
import type { ServerConfig } from "@repo/config/server";
import { SERVER_CONFIG } from "../config/config.module.ts";
import { EMAIL_SENDER, LogEmailSender, SmtpEmailSender } from "./email.sender.ts";
import { EmailService } from "./email.service.ts";

@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) =>
        config.email.smtp
          ? new SmtpEmailSender(config.email.smtp)
          : new LogEmailSender(),
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
