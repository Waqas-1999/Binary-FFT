import { Module } from "@nestjs/common";
import type { ServerConfig } from "@repo/config/server";
import { SERVER_CONFIG } from "../config/config.module.ts";
import { EmailModule } from "../email/email.module.ts";
import { AccountSecurityService } from "./account-security.service.ts";
import { AuthEventsService } from "./auth-events.service.ts";
import { AuthController } from "./auth.controller.ts";
import { AuthGuard } from "./auth.guard.ts";
import { AuthService } from "./auth.service.ts";
import { GoogleAuthController } from "./google-auth.controller.ts";
import { GoogleOAuthService } from "./google-oauth.service.ts";
import { GOOGLE_OAUTH_CLIENT, HttpGoogleOAuthClient } from "./oauth/google.client.ts";
import { LoginChallengeService } from "./login-challenge.service.ts";
import { LoginSessionService } from "./login-session.service.ts";
import { OAuthStateService } from "./oauth/oauth-state.service.ts";
import { SecurityController } from "./security.controller.ts";
import { SecurityNotifier } from "./security-notifier.service.ts";
import { TwoFactorController } from "./two-factor/two-factor.controller.ts";
import { TwoFactorService } from "./two-factor/two-factor.service.ts";
import { PasswordService } from "./password.service.ts";
import { SessionService } from "./session.service.ts";

/** Import this module to protect routes with `@Authenticated()`. */
@Module({
  imports: [EmailModule],
  controllers: [AuthController, GoogleAuthController, SecurityController, TwoFactorController],
  providers: [
    AccountSecurityService,
    AuthService,
    AuthEventsService,
    AuthGuard,
    GoogleOAuthService,
    LoginChallengeService,
    LoginSessionService,
    OAuthStateService,
    PasswordService,
    SecurityNotifier,
    SessionService,
    TwoFactorService,
    {
      // Null when Google sign-in is not configured; the service then answers "unavailable".
      provide: GOOGLE_OAUTH_CLIENT,
      inject: [SERVER_CONFIG],
      useFactory: (config: ServerConfig) => (config.google ? new HttpGoogleOAuthClient(config.google) : null),
    },
  ],
  exports: [AuthEventsService, AuthGuard, AuthService, SessionService],
})
export class AuthModule {}
