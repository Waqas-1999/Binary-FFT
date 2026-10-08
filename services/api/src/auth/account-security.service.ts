import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { SecurityStatus, SessionInfo } from "@repo/types";
import { type ChangePasswordInput, passwordAvoidsEmail, type ReauthenticateInput } from "@repo/validation";
import { ApiError } from "../common/api-error.ts";
import type { ClientInfo } from "../common/client-info.ts";
import { plainIp, summarizeUserAgent } from "../common/user-agent.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { RateLimitService } from "../rate-limit/rate-limit.service.ts";
import { AuthEventsService } from "./auth-events.service.ts";
import { authConfig } from "./auth.config.ts";
import { PasswordService } from "./password.service.ts";
import { SecurityNotifier } from "./security-notifier.service.ts";
import { type AuthContext, SessionService } from "./session.service.ts";
import { TwoFactorService } from "./two-factor/two-factor.service.ts";

const { rateLimits, recentAuthSeconds } = authConfig;

/** Signed-in account security: status, reauthentication, password change and device management. */
@Injectable()
export class AccountSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly events: AuthEventsService,
    private readonly rateLimit: RateLimitService,
    private readonly notifier: SecurityNotifier,
  ) {}

  async status(auth: AuthContext): Promise<SecurityStatus> {
    const [account, google, twoFactor] = await Promise.all([
      this.prisma.emailAccount.count({ where: { userId: auth.userId } }),
      this.prisma.oAuthIdentity.count({ where: { userId: auth.userId, provider: "GOOGLE" } }),
      this.twoFactor.status(auth.userId),
    ]);
    return {
      hasPassword: account > 0,
      googleConnected: google > 0,
      twoFactor,
      twoFactorAvailable: this.twoFactor.available,
      recentlyAuthenticated: Date.now() - auth.authenticatedAt.getTime() <= recentAuthSeconds * 1000,
    };
  }

  /**
   * Proves the signed-in user still knows their password and stamps the session. The proof lives on the
   * server's session row, not in anything the client sends, and expires after `recentAuthSeconds`.
   * Google-only accounts reauthenticate through Google instead (see `GoogleOAuthService.startReauth`).
   */
  async reauthenticate(auth: AuthContext, { password }: ReauthenticateInput, client: ClientInfo): Promise<void> {
    await this.rateLimit.consume(`reauth:user:${auth.userId}`, rateLimits.reauthPerUser);

    const account = await this.prisma.emailAccount.findUnique({ where: { userId: auth.userId }, select: { passwordHash: true } });
    if (!account) {
      throw new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", "This account has no password; confirm with Google instead");
    }
    if (!password || !(await this.passwords.verify(account.passwordHash, password))) {
      await this.events.record("REAUTHENTICATION_FAILED", { userId: auth.userId, sessionId: auth.sessionId, client, metadata: { method: "password" } });
      throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Incorrect password.");
    }

    await this.sessions.markAuthenticated(auth.sessionId);
    await this.events.record("REAUTHENTICATION_SUCCESS", { userId: auth.userId, sessionId: auth.sessionId, client, metadata: { method: "password" } });
  }

  /**
   * Changes the password. The current password (and, with two-factor on, a current authenticator code) is
   * checked in this very request, so it is its own reauthentication. Every other session is revoked; this
   * one stays because it just proved knowledge of the old password.
   */
  async changePassword(auth: AuthContext, { currentPassword, newPassword, code }: ChangePasswordInput, client: ClientInfo): Promise<{ revokedSessions: number }> {
    await this.rateLimit.consume(`change-password:user:${auth.userId}`, rateLimits.changePasswordPerUser);

    const account = await this.prisma.emailAccount.findUnique({
      where: { userId: auth.userId },
      select: { email: true, passwordHash: true },
    });
    if (!account) {
      throw new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", "This account has no password to change");
    }
    if (!(await this.passwords.verify(account.passwordHash, currentPassword))) {
      await this.events.record("REAUTHENTICATION_FAILED", { userId: auth.userId, sessionId: auth.sessionId, client, metadata: { method: "password", action: "change_password" } });
      throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Incorrect password.");
    }
    if (!passwordAvoidsEmail(account.email, newPassword)) {
      throw new HttpException(
        { code: "VALIDATION_FAILED", message: "Invalid request", issues: [{ path: "newPassword", message: "Don't use your email in your password" }] },
        HttpStatus.BAD_REQUEST,
      );
    }

    const newHash = await this.passwords.hash(newPassword);
    const revokedSessions = await this.prisma.$transaction(async (tx) => {
      if (await this.twoFactor.isEnabled(auth.userId)) {
        if (!code || !(await this.twoFactor.verifyTotp(auth.userId, code, tx))) {
          throw new ApiError(HttpStatus.UNAUTHORIZED, "TWO_FACTOR_CODE_INVALID", "That code didn't work. Check your authenticator app and try again.");
        }
      }
      const now = new Date();
      await tx.emailAccount.update({ where: { userId: auth.userId }, data: { passwordHash: newHash }, select: { id: true } });
      // A password the person just replaced shouldn't be recoverable through an old reset email.
      await tx.passwordResetToken.updateMany({ where: { userId: auth.userId, usedAt: null }, data: { usedAt: now } });
      await tx.session.update({ where: { id: auth.sessionId }, data: { authenticatedAt: now }, select: { id: true } });
      const others = await tx.session.updateMany({
        where: { userId: auth.userId, revokedAt: null, id: { not: auth.sessionId } },
        data: { revokedAt: now },
      });
      return others.count;
    });

    await this.events.record("PASSWORD_CHANGED", { userId: auth.userId, sessionId: auth.sessionId, client, metadata: { revokedSessions } });
    this.notifier.notify(auth.userId, "password_changed", client);
    return { revokedSessions };
  }

  async listSessions(auth: AuthContext): Promise<SessionInfo[]> {
    const sessions = await this.sessions.listActive(auth.userId);
    return sessions.map((session) => ({
      id: session.id,
      current: session.id === auth.sessionId,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString(),
      ipAddress: plainIp(session.ipAddress),
      device: summarizeUserAgent(session.userAgent),
    }));
  }

  /** Revokes one other session. Unknown, foreign and already-revoked sessions all look like "not found". */
  async revokeSession(auth: AuthContext, sessionId: string, client: ClientInfo): Promise<void> {
    await this.rateLimit.consume(`session-actions:user:${auth.userId}`, rateLimits.sessionActionsPerUser);
    if (sessionId === auth.sessionId) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Use sign out to end this session");
    }
    if (!(await this.sessions.revokeOwned(auth.userId, sessionId))) {
      throw new ApiError(HttpStatus.NOT_FOUND, "NOT_FOUND", "Session not found");
    }
    await this.events.record("SESSION_REVOKED", { userId: auth.userId, sessionId, client, metadata: { by: "user", revokedBy: auth.sessionId } });
  }

  /** "Sign out all other devices": one statement, and never the current session. */
  async revokeOtherSessions(auth: AuthContext, client: ClientInfo): Promise<{ revoked: number }> {
    await this.rateLimit.consume(`session-actions:user:${auth.userId}`, rateLimits.sessionActionsPerUser);
    const revoked = await this.sessions.revokeOthers(auth.userId, auth.sessionId);
    await this.events.record("SESSIONS_REVOKED", { userId: auth.userId, sessionId: auth.sessionId, client, metadata: { count: revoked } });
    return { revoked };
  }
}
