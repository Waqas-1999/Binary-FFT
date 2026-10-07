import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { GoogleOAuthConfig, ServerConfig } from "@repo/config/server";
import type { AuthUser } from "@repo/types";
import { ApiError } from "../common/api-error.ts";
import type { ClientInfo } from "../common/client-info.ts";
import { SERVER_CONFIG } from "../config/config.module.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { EmailService } from "../email/email.service.ts";
import { SessionService } from "./session.service.ts";
import { AuthEventsService } from "./auth-events.service.ts";
import { OAuthStateService } from "./oauth/oauth-state.service.ts";
import { Prisma } from "../generated/prisma/client.js";
import { exchangeCodeForTokens, validateGoogleIdToken } from "./oauth/google-id-token.validator.ts";

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly google: GoogleOAuthConfig | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: EmailService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
    private readonly oAuthState: OAuthStateService,
    @Inject(SERVER_CONFIG) config: ServerConfig,
  ) {
    this.google = config.google;
    if (!this.google) this.logger.warn("Google OAuth is not configured");
  }

  /** The configured Google client, or a 503 when Google sign-in is not set up on this server. */
  private requireGoogle(): GoogleOAuthConfig {
    if (!this.google) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "SERVICE_UNAVAILABLE",
        "Google OAuth is not configured on the server",
      );
    }
    return this.google;
  }

  /** Initiates the Google OAuth login flow. Returns the state to pass to Google. */
  async initiateLogin(): Promise<string> {
    const state = await this.oAuthState.create("login");
    await this.events.record("GOOGLE_LOGIN_STARTED", {});
    return state;
  }

  /** Handles the Google OAuth callback for login or account creation. */
  async handleLoginCallback(state: string, code: string, client: ClientInfo): Promise<{ user: AuthUser; sessionToken: string; sessionExpiresAt: Date }> {
    try {
      await this.oAuthState.consume(state, "login", undefined);
    } catch {
      throw new ApiError(HttpStatus.BAD_REQUEST, "OAUTH_STATE_INVALID", "Invalid or expired OAuth state");
    }

    const google = this.requireGoogle();

    let tokens: { idToken: string; accessToken?: string };
    try {
      tokens = await exchangeCodeForTokens(
        code,
        google.clientId,
        google.clientSecret,
        google.redirectUri,
      );
    } catch {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        "INVALID_CREDENTIALS",
        "Failed to exchange authorization code",
      );
    }

    let googleIdentity: GoogleIdentity;
    try {
      googleIdentity = await validateGoogleIdToken(tokens.idToken, google.clientId);
    } catch {
      throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid Google identity token");
    }

    const { sub, email, emailVerified } = googleIdentity;
    const normalizedEmail = email.trim().toLowerCase();

    // Check if an OAuth identity already exists for this Google subject
    const existingIdentity = await this.prisma.oAuthIdentity.findUnique({
      where: { provider_providerSubject: { provider: "GOOGLE", providerSubject: sub } },
      select: { id: true, userId: true, user: { select: { id: true, userNumber: true, status: true, emailAccount: { select: { email: true, emailVerifiedAt: true } } } } },
    });

    if (existingIdentity) {
      // Google identity already linked to a user
      if (existingIdentity.user.status !== "ACTIVE") {
        throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Account is disabled");
      }

      // Sign in the existing user
      const session = await this.sessions.create(existingIdentity.userId, client);
      await this.events.record("GOOGLE_LOGIN_SUCCESS", {
        userId: existingIdentity.userId,
        sessionId: session.sessionId,
        client,
        metadata: { method: "google" },
      });

      return {
        user: {
          userNumber: existingIdentity.user.userNumber,
          email: existingIdentity.user.emailAccount?.email ?? "",
          emailVerified: Boolean(existingIdentity.user.emailAccount?.emailVerifiedAt),
        },
        sessionToken: session.token,
        sessionExpiresAt: session.expiresAt,
      };
    }

    // No existing OAuth identity for this Google subject.
    // Check if the email is already associated with a password account.
    const existingEmailAccount = await this.prisma.emailAccount.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, userId: true, user: { select: { id: true, userNumber: true, status: true } } },
    });

    if (existingEmailAccount) {
      // Email already exists as password account - do not auto-link
      throw new ApiError(
        HttpStatus.CONFLICT,
        "OAUTH_ACCOUNT_CONFLICT",
        "An account with this email already exists. Please sign in with your email and password, then link your Google account from the profile page.",
      );
    }

    // Create new user and OAuth identity
    let created: { userId: string; userNumber: number };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: {}, select: { id: true, userNumber: true } });
        await tx.oAuthIdentity.create({
          data: { userId: user.id, provider: "GOOGLE", providerSubject: sub, emailAtLinkTime: email },
          select: { id: true },
        });
        return { userId: user.id, userNumber: user.userNumber };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Race condition: another request created the account first
        // Retry lookup
        const retryIdentity = await this.prisma.oAuthIdentity.findUnique({
          where: { provider_providerSubject: { provider: "GOOGLE", providerSubject: sub } },
          select: { userId: true, user: { select: { userNumber: true, status: true, emailAccount: { select: { email: true, emailVerifiedAt: true } } } } },
        });
        if (retryIdentity) {
          const session = await this.sessions.create(retryIdentity.userId, client);
          await this.events.record("GOOGLE_LOGIN_SUCCESS", {
            userId: retryIdentity.userId,
            sessionId: session.sessionId,
            client,
            metadata: { method: "google" },
          });

          return {
            user: {
              userNumber: retryIdentity.user.userNumber,
              email: retryIdentity.user.emailAccount?.email ?? "",
              emailVerified: Boolean(retryIdentity.user.emailAccount?.emailVerifiedAt),
            },
            sessionToken: session.token,
            sessionExpiresAt: session.expiresAt,
          };
        }
      }
      throw error;
    }

    // Create session for the new user
    const session = await this.sessions.create(created.userId, client);
    await this.events.record("GOOGLE_LOGIN_SUCCESS", {
      userId: created.userId,
      sessionId: session.sessionId,
      client,
      metadata: { method: "google" },
    });

    return {
      user: {
        userNumber: created.userNumber,
        email: normalizedEmail,
        emailVerified,
      },
      sessionToken: session.token,
      sessionExpiresAt: session.expiresAt,
    };
  }

  /** Initiates the Google OAuth linking flow for an already authenticated user. */
  async initiateLink(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user || user.status !== "ACTIVE") {
      throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Authentication required");
    }

    const state = await this.oAuthState.create("link", userId);
    await this.events.record("GOOGLE_LINK_STARTED", { userId });
    return state;
  }

  /** Handles the Google OAuth callback for account linking. */
  async handleLinkCallback(
    state: string,
    code: string,
    userId: string,
    client: ClientInfo,
  ): Promise<{ success: boolean; message: string }> {
    let consumed: { type: string; userId: string | null };
    try {
      consumed = await this.oAuthState.consume(state, "link", userId);
    } catch {
      throw new ApiError(HttpStatus.BAD_REQUEST, "OAUTH_STATE_INVALID", "Invalid or expired OAuth state");
    }

    if (consumed.userId !== userId) {
      throw new ApiError(HttpStatus.FORBIDDEN, "OAUTH_LINK_REJECTED", "OAuth state does not match authenticated user");
    }

    const google = this.requireGoogle();

    let tokens: { idToken: string; accessToken?: string };
    try {
      tokens = await exchangeCodeForTokens(
        code,
        google.clientId,
        google.clientSecret,
        google.redirectUri,
      );
    } catch {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        "INVALID_CREDENTIALS",
        "Failed to exchange authorization code",
      );
    }

    let googleIdentity: GoogleIdentity;
    try {
      googleIdentity = await validateGoogleIdToken(tokens.idToken, google.clientId);
    } catch {
      throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid Google identity token");
    }

    const { sub, email } = googleIdentity;

    // Check if the Google identity is already linked to another user
    const identityBelongsToAnother = await this.prisma.oAuthIdentity.findFirst({
      where: { provider: "GOOGLE", providerSubject: sub, userId: { not: userId } },
      select: { userId: true, user: { select: { id: true, userNumber: true, status: true } } },
    });

    if (identityBelongsToAnother) {
      // Identity already linked to a different user - reject
      await this.events.record("GOOGLE_LINK_CONFLICT", {
        userId,
        client,
        metadata: { reason: "identity_already_linked", subject: sub.slice(0, 8) },
      });
      throw new ApiError(
        HttpStatus.CONFLICT,
        "OAUTH_LINK_CONFLICT",
        "This Google account is already linked to another BINERY account. Please sign in with that account instead.",
      );
    }

    // Check if the user already has a Google identity linked
    const existingLink = await this.prisma.oAuthIdentity.findFirst({
      where: { userId, provider: "GOOGLE" },
      select: { providerSubject: true },
    });

    if (existingLink) {
      // User already has Google linked - this is a success (already linked)
      await this.events.record("GOOGLE_LINK_SUCCESS", { userId, client });
      return { success: true, message: "Google account already linked to this profile." };
    }

    // Attach the OAuth identity to the authenticated user
    await this.prisma.oAuthIdentity.create({
      data: { userId, provider: "GOOGLE", providerSubject: sub, emailAtLinkTime: email },
      select: { id: true },
    });

    await this.events.record("GOOGLE_LINK_SUCCESS", { userId, client });
    return { success: true, message: "Google account successfully linked to your profile." };
  }
}