import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module.ts";
import { AuthEventsService } from "./auth-events.service.ts";
import { AuthController } from "./auth.controller.ts";
import { AuthGuard } from "./auth.guard.ts";
import { AuthService } from "./auth.service.ts";
import { PasswordService } from "./password.service.ts";
import { SessionService } from "./session.service.ts";

/** Import this module to protect routes with `@Authenticated()`. */
@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [AuthService, AuthEventsService, AuthGuard, PasswordService, SessionService],
  exports: [AuthGuard, SessionService],
})
export class AuthModule {}
