import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { OAuthLinkResult, OAuthLoginError, OAuthReauthResult } from "@repo/types";
import { toErrorMessage } from "@repo/utils";
import { createHash } from "node:crypto";
import { ApiError, RateLimitedException } from "../common/api-error.ts";
import type { ClientInfo } from "../common/client-info.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { Prisma, type UserStatus } from "../generated/prisma/client.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.ts";
import { AuthEventsService } from "./auth-events.service.ts";
import { authConfig } from "./auth.config.ts";
import { GOOGLE_OAUTH_CLIENT, type GoogleIdentity, type GoogleOAuthClient } from "./oauth/google.client.ts";
import { LoginSessionService } from "./login-session.service.ts";
import { safeReturnPath } from "./oauth/oauth-redirect.ts";
import { type OAuthFlow, OAuthStateService } from "./oauth/oauth-state.service.ts";
import { type AuthContext, SessionService } from "./session.service.ts";

const { rateLimits } = authConfig;
const PROVIDER = "GOOGLE" as const;

export interface StartedGoogleFlow {
  /** Where to send the browser: Google's authorization endpoint. */
  authorizationUrl: string;
  /** Opaque value for the browser-binding cookie. */
  binding: string;
}

/** What the callback controller should do next. Contains no secrets beyond the new session token. */
export type GoogleCallbackOutcome =
  | { kind: "login"; sessionToken: string; expiresAt: Date; returnTo: string }
  | { kind: "two-factor"; challengeToken: string; expiresAt: Date; returnTo: string }
  | { kind: "login-failed"; error: OAuthLoginError }
  | { kind: "link"; result: OAuthLinkResult }
  | { kind: "reauth"; result: OAuthReauthResult };

/**
 * Google sign-in and account linking.
 *
 * Identity is Google's stable `sub`, never the email. Sign-in never attaches Google to an existing
 * password account just because the emails match; that only happens through `link`, which needs
 * a signed-in session that is also the one that started the flow.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
    private readonly oAuthState: OAuthStateService,
    private readonly rateLimit: RateLimitService,
    private readonly loginSessions: LoginSessionService,
    @Inject(GOOGLE_OAUTH_CLIENT) private readonly google: GoogleOAuthClient | null,
  ) {}

  /** Begins sign-in. `next` is reduced to an allowlisted internal path. */
  async startLogin(next: unknown, client: ClientInfo): Promise<StartedGoogleFlow> {
    await this.rateLimit.consume(`google-start:ip:${client.ip}`, rateLimits.googleOAuthPerIp);
    const flow = await this.start({ purpose: "login", userId: null, returnTo: safeReturnPath(next) });
    await this.events.record("GOOGLE_LOGIN_STARTED", { client });
    return flow;
  }

  /** Begins linking Google to the signed-in user. Returns to the profile page. */
  async startLink(userId: string, client: ClientInfo): Promise<StartedGoogleFlow> {
    await this.rateLimit.consume(`google-link:user:${userId}`, rateLimits.googleLinkPerUser);
    const flow = await this.start({ purpose: "link", userId, returnTo: "/profile" });
    await this.events.record("GOOGLE_LINK_STARTED", { userId, client });
    return flow;
  }

  /**
   * Starts reauthentication for an account that signs in with Google: Google is asked to make the person
   * sign in again, and the callback only stamps the session if it is the same Google account.
   */
  async startReauth(auth: AuthContext): Promise<StartedGoogleFlow> {
    await this.rateLimit.consume(`reauth:user:${auth.userId}`, rateLimits.reauthPerUser);
    const linked = await this.prisma.oAuthIdentity.count({ where: { userId: auth.userId, provider: PROVIDER } });
    if (linked === 0) {
      throw new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", "No Google account is connected");
    }
    return this.start({ purpose: "reauth", userId: auth.userId, returnTo: "/profile", forceLogin: true });
  }

  /**
   * Handles Google's redirect back. Never throws: every failure becomes a generic outcome so the
   * browser always lands on a normal page and learns nothing about why.
   */
  async complete(
    query: { state?: string; code?: string; error?: string },
    binding: string | undefined,
    sessionToken: string | undefined,
    client: ClientInfo,
  ): Promise<GoogleCallbackOutcome> {
    let flow: OAuthFlow | null = null;
    try {
      await this.rateLimit.consume(`google-callback:ip:${client.ip}`, rateLimits.googleOAuthPerIp);
      flow = query.state ? await this.oAuthState.consume(query.state, binding) : null;
      if (!flow) return await this.reject("login", undefined, "invalid_state", client);
      if (query.error || !query.code) return await this.reject(flow.purpose, flow.userId, "authorization_denied", client);

      let identity: GoogleIdentity;
      try {
        identity = await this.requireClient().identify({
          code: query.code,
          codeVerifier: flow.codeVerifier,
          nonce: flow.nonce,
        });
      } catch (error) {
        this.logger.warn(`Google identity rejected: ${toErrorMessage(error)}`);
        return await this.reject(flow.purpose, flow.userId, "identity_rejected", client);
      }

      if (flow.purpose === "login") return await this.signIn(identity, flow.returnTo, client);
      if (flow.purpose === "reauth") return await this.reauthenticate(identity, flow.userId, sessionToken, client);
      return await this.link(identity, flow.userId, sessionToken, client);
    } catch (error) {
      const unavailable =
        error instanceof RateLimitedException ||
        (error instanceof ApiError && error.getStatus() === HttpStatus.SERVICE_UNAVAILABLE);
      if (!unavailable) this.logger.error(`Google callback failed: ${toErrorMessage(error)}`);
      if (flow?.purpose === "link") return { kind: "link", result: "failed" };
      if (flow?.purpose === "reauth") return { kind: "reauth", result: "failed" };
      return { kind: "login-failed", error: unavailable ? "oauth_unavailable" : "oauth_failed" };
    }
  }

  private async start({
    forceLogin,
    ...flow
  }: {
    purpose: "login" | "link" | "reauth";
    userId: string | null;
    returnTo: string;
    forceLogin?: boolean;
  }): Promise<StartedGoogleFlow> {
    const google = this.requireClient();
    const started = await this.oAuthState.start({ provider: PROVIDER, ...flow });
    const codeChallenge = createHash("sha256").update(started.codeVerifier).digest("base64url");
    return {
      authorizationUrl: google.authorizationUrl({ state: started.state, nonce: started.nonce, codeChallenge, forceLogin }),
      binding: started.binding,
    };
  }

  private requireClient(): GoogleOAuthClient {
    if (!this.google) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", "Google sign-in is not configured");
    }
    return this.google;
  }

  private async signIn(identity: GoogleIdentity, returnTo: string, client: ClientInfo): Promise<GoogleCallbackOutcome> {
    const existing = await this.findIdentity(identity.subject);
    if (existing) return this.startSession(existing.userId, existing.user.status, returnTo, false, client);

    // A verified password account owns this email: never merge. The person signs in the usual way
    // and connects Google from their profile.
    const passwordAccount = await this.prisma.emailAccount.findFirst({
      where: { email: identity.email, emailVerifiedAt: { not: null } },
      select: { id: true },
    });
    if (passwordAccount) {
      await this.events.record("GOOGLE_LOGIN_FAILED", { client, metadata: { reason: "password_account_exists" } });
      return { kind: "login-failed", error: "oauth_account_exists" };
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: {}, select: { id: true, userNumber: true } });
        await tx.oAuthIdentity.create({
          data: {
            userId: user.id,
            provider: PROVIDER,
            providerSubject: identity.subject,
            emailAtLinkTime: identity.email,
          },
          select: { id: true },
        });
        return user;
      });
      await this.events.record("USER_CREATED", {
        userId: created.id,
        client,
        metadata: { userNumber: created.userNumber, method: "google" },
      });
      return await this.startSession(created.id, "ACTIVE", returnTo, true, client);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrent callback for the same Google account created it first: sign in to that user.
      const winner = await this.findIdentity(identity.subject);
      if (!winner) throw error;
      return this.startSession(winner.userId, winner.user.status, returnTo, false, client);
    }
  }

  private async startSession(
    userId: string,
    status: UserStatus,
    returnTo: string,
    created: boolean,
    client: ClientInfo,
  ): Promise<GoogleCallbackOutcome> {
    if (status !== "ACTIVE") {
      await this.events.record("GOOGLE_LOGIN_FAILED", { userId, client, metadata: { reason: "account_disabled" } });
      return { kind: "login-failed", error: "oauth_failed" };
    }
    const outcome = await this.loginSessions.afterFirstFactor(userId, "google", client, { newUser: created });
    if (outcome.kind === "challenge") {
      return { kind: "two-factor", challengeToken: outcome.token, expiresAt: outcome.expiresAt, returnTo };
    }
    return { kind: "login", sessionToken: outcome.token, expiresAt: outcome.expiresAt, returnTo };
  }

  /** Stamps the session only if the person signed in to the same Google account linked to it. */
  private async reauthenticate(
    identity: GoogleIdentity,
    flowUserId: string | null,
    sessionToken: string | undefined,
    client: ClientInfo,
  ): Promise<GoogleCallbackOutcome> {
    const auth = sessionToken ? await this.sessions.authenticate(sessionToken) : null;
    const linked = flowUserId ? await this.findIdentity(identity.subject) : null;
    if (!auth || !flowUserId || auth.userId !== flowUserId || linked?.userId !== flowUserId) {
      await this.events.record("REAUTHENTICATION_FAILED", {
        userId: flowUserId ?? undefined,
        client,
        metadata: { method: "google" },
      });
      return { kind: "reauth", result: "failed" };
    }
    await this.sessions.markAuthenticated(auth.sessionId);
    await this.events.record("REAUTHENTICATION_SUCCESS", {
      userId: auth.userId,
      sessionId: auth.sessionId,
      client,
      metadata: { method: "google" },
    });
    return { kind: "reauth", result: "ok" };
  }

  private async link(
    identity: GoogleIdentity,
    flowUserId: string | null,
    sessionToken: string | undefined,
    client: ClientInfo,
  ): Promise<GoogleCallbackOutcome> {
    // The signed-in session is the only authority on who is linking, and it must be the session
    // that started this flow. A state value alone can never attach an identity to a user.
    const auth = sessionToken ? await this.sessions.authenticate(sessionToken) : null;
    if (!auth || !flowUserId || auth.userId !== flowUserId) {
      await this.events.record("GOOGLE_LINK_FAILED", {
        userId: flowUserId ?? undefined,
        client,
        metadata: { reason: "session_mismatch" },
      });
      return { kind: "link", result: "failed" };
    }
    const userId = auth.userId;

    const owner = await this.findIdentity(identity.subject);
    if (owner?.userId === userId) {
      await this.events.record("GOOGLE_LINK_SUCCESS", { userId, client, metadata: { alreadyLinked: true } });
      return { kind: "link", result: "linked" };
    }
    if (owner) return this.linkConflict(userId, client);

    const ownGoogle = await this.prisma.oAuthIdentity.findUnique({
      where: { userId_provider: { userId, provider: PROVIDER } },
      select: { id: true },
    });
    if (ownGoogle) {
      await this.events.record("GOOGLE_LINK_FAILED", {
        userId,
        client,
        metadata: { reason: "different_google_account_linked" },
      });
      return { kind: "link", result: "failed" };
    }

    try {
      await this.prisma.oAuthIdentity.create({
        data: { userId, provider: PROVIDER, providerSubject: identity.subject, emailAtLinkTime: identity.email },
        select: { id: true },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.linkConflict(userId, client);
    }
    await this.events.record("GOOGLE_LINK_SUCCESS", { userId, client });
    return { kind: "link", result: "linked" };
  }

  private async linkConflict(userId: string, client: ClientInfo): Promise<GoogleCallbackOutcome> {
    // Never merges or moves identities, and never says which user owns it.
    await this.events.record("GOOGLE_LINK_CONFLICT", {
      userId,
      client,
      metadata: { reason: "identity_owned_by_another_user" },
    });
    return { kind: "link", result: "conflict" };
  }

  private findIdentity(subject: string) {
    return this.prisma.oAuthIdentity.findUnique({
      where: { provider_providerSubject: { provider: PROVIDER, providerSubject: subject } },
      select: { userId: true, user: { select: { status: true } } },
    });
  }

  private async reject(
    purpose: "login" | "link" | "reauth",
    userId: string | null | undefined,
    reason: string,
    client: ClientInfo,
  ): Promise<GoogleCallbackOutcome> {
    const type =
      purpose === "link" ? "GOOGLE_LINK_FAILED" : purpose === "reauth" ? "REAUTHENTICATION_FAILED" : "GOOGLE_LOGIN_FAILED";
    await this.events.record(type, { userId: userId ?? undefined, client, metadata: { reason } });
    if (purpose === "link") return { kind: "link", result: "failed" };
    if (purpose === "reauth") return { kind: "reauth", result: "failed" };
    return { kind: "login-failed", error: "oauth_failed" };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
