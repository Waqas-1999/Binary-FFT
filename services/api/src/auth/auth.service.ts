import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { ServerConfig } from "@repo/config/server";
import type { AuthUser } from "@repo/types";
import { toErrorMessage } from "@repo/utils";
import { type LoginInput, passwordAvoidsEmail, type SignupInput } from "@repo/validation";
import { ApiError } from "../common/api-error.ts";
import type { ClientInfo } from "../common/client-info.ts";
import { SERVER_CONFIG } from "../config/config.module.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { EmailService } from "../email/email.service.ts";
import { Prisma } from "../generated/prisma/client.js";
import { RateLimitService, rateLimitId } from "../rate-limit/rate-limit.service.ts";
import { AuthEventsService } from "./auth-events.service.ts";
import { authConfig } from "./auth.config.ts";
import { LoginSessionService } from "./login-session.service.ts";
import { PasswordService } from "./password.service.ts";
import { SessionService } from "./session.service.ts";
import { generateToken, hashToken } from "./tokens.ts";

export interface NewSession {
  token: string;
  expiresAt: Date;
  user: AuthUser;
}

/** A completed first factor either opens a session or, with two-factor on, a challenge to finish. */
export type AuthResult =
  | { kind: "session"; session: NewSession }
  | { kind: "challenge"; token: string; expiresAt: Date };

const { rateLimits, verificationToken, passwordResetToken } = authConfig;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly webAppUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
    private readonly emails: EmailService,
    private readonly rateLimit: RateLimitService,
    private readonly loginSessions: LoginSessionService,
    @Inject(SERVER_CONFIG) config: ServerConfig,
  ) {
    this.webAppUrl = config.app.webAppUrl;
  }

  /**
   * Creates an unverified account and emails a verification link. The outcome is identical for
   * new and existing addresses so the response never reveals whether an email is registered.
   */
  async signup({ email, password }: SignupInput, client: ClientInfo): Promise<void> {
    await this.rateLimit.consume(`signup:ip:${client.ip}`, rateLimits.signupPerIp);
    await this.events.record("SIGNUP_STARTED", { email, client });

    // Hash before the lookup so new and existing addresses take the same time.
    const passwordHash = await this.passwords.hash(password);
    const existing = await this.prisma.emailAccount.findUnique({
      where: { email },
      select: { id: true, userId: true, emailVerifiedAt: true },
    });
    if (existing) return this.notifyExistingAccount(existing, email, client);

    let created: { userId: string; userNumber: number; accountId: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: {}, select: { id: true, userNumber: true } });
        const account = await tx.emailAccount.create({
          data: { userId: user.id, email, passwordHash },
          select: { id: true },
        });
        return { userId: user.id, userNumber: user.userNumber, accountId: account.id };
      });
    } catch (error) {
      // A concurrent signup for the same address won the race: behave as for an existing account.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
      throw error;
    }

    await this.events.record("USER_CREATED", {
      userId: created.userId,
      client,
      metadata: { userNumber: created.userNumber },
    });
    await this.sendVerificationEmail(created.accountId, created.userId, email, client);
  }

  /** Always succeeds from the caller's point of view; sends only for unverified accounts. */
  async resendVerification(email: string, client: ClientInfo): Promise<void> {
    await this.rateLimit.consume(`resend:ip:${client.ip}`, rateLimits.resendPerIp);
    const account = await this.prisma.emailAccount.findUnique({
      where: { email },
      select: { id: true, userId: true, emailVerifiedAt: true },
    });
    if (account && !account.emailVerifiedAt) {
      await this.sendVerificationEmail(account.id, account.userId, email, client);
    }
  }

  /** Consumes a verification token, marks the email verified and signs the user in. */
  async verifyEmail(token: string, client: ClientInfo): Promise<AuthResult> {
    await this.rateLimit.consume(`verify:ip:${client.ip}`, rateLimits.verifyPerIp);
    const tokenHash = hashToken(token);
    const now = new Date();

    // Atomic claim: concurrent requests with the same token cannot both succeed.
    const claimed = await this.prisma.emailVerificationToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "VERIFICATION_LINK_INVALID", "This verification link is invalid or has expired.");
    }

    const { emailAccount: account } = await this.prisma.emailVerificationToken.findUniqueOrThrow({
      where: { tokenHash },
      select: {
        emailAccount: {
          select: { id: true, userId: true, email: true, user: { select: { status: true, userNumber: true } } },
        },
      },
    });

    await this.prisma.$transaction([
      this.prisma.emailAccount.updateMany({
        where: { id: account.id, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      }),
      // Other outstanding links for this address are no longer needed.
      this.prisma.emailVerificationToken.updateMany({
        where: { emailAccountId: account.id, usedAt: null },
        data: { usedAt: now },
      }),
    ]);
    await this.events.record("EMAIL_VERIFIED", { userId: account.userId });

    if (account.user.status !== "ACTIVE") {
      throw new ApiError(HttpStatus.BAD_REQUEST, "VERIFICATION_LINK_INVALID", "This verification link is invalid or has expired.");
    }
    return this.startSession(account.userId, client, "email_verification");
  }

  /**
   * Signs in with email and password. Unknown email, wrong password and disabled account all
   * return the same error, with equalized timing. Unverified accounts are told so only after the
   * password is proven, and get a fresh verification link.
   */
  async login({ email, password }: LoginInput, client: ClientInfo): Promise<AuthResult> {
    await this.rateLimit.consume(`login:ip:${client.ip}`, rateLimits.loginPerIp);
    const failureKey = `login-failures:email:${rateLimitId(email)}`;
    // Checked before verifying, so a locked email stays locked even for the right password.
    await this.rateLimit.assertAvailable(failureKey, rateLimits.loginFailuresPerEmail);

    const account = await this.prisma.emailAccount.findUnique({
      where: { email },
      select: {
        id: true,
        userId: true,
        email: true,
        passwordHash: true,
        emailVerifiedAt: true,
        user: { select: { status: true, userNumber: true } },
      },
    });

    const passwordValid = account
      ? await this.passwords.verify(account.passwordHash, password)
      : await this.passwords.verifyAgainstDummy(password);

    if (!account || !passwordValid || account.user.status !== "ACTIVE") {
      await this.rateLimit.hit(failureKey, rateLimits.loginFailuresPerEmail);
      await this.events.record("LOGIN_FAILED", { userId: account?.userId, email, client });
      throw new ApiError(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Incorrect email or password.");
    }

    if (!account.emailVerifiedAt) {
      await this.sendVerificationEmail(account.id, account.userId, account.email, client);
      throw new ApiError(HttpStatus.FORBIDDEN, "EMAIL_NOT_VERIFIED", "Verify your email address to sign in.");
    }

    return this.startSession(account.userId, client, "password");
  }

  /** Revokes the session server-side. Safe to call with an unknown or already revoked token. */
  async logout(token: string | undefined, client: ClientInfo): Promise<void> {
    if (!token) return;
    const revoked = await this.sessions.revokeByToken(token);
    if (revoked) await this.events.record("LOGOUT", { ...revoked, client });
  }

  async getUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        userNumber: true,
        emailAccount: { select: { email: true, emailVerifiedAt: true } },
        oAuthIdentities: { where: { provider: "GOOGLE" }, select: { emailAtLinkTime: true } },
      },
    });
    const google = user.oAuthIdentities[0];
    return {
      userNumber: user.userNumber,
      // Google-only accounts have no password account; show the email Google reported (always verified).
      email: user.emailAccount?.email ?? google?.emailAtLinkTime ?? "",
      emailVerified: user.emailAccount ? Boolean(user.emailAccount.emailVerifiedAt) : Boolean(google),
      googleConnected: Boolean(google),
    };
  }

  private async startSession(userId: string, client: ClientInfo, method: "password" | "email_verification"): Promise<AuthResult> {
    const outcome = await this.loginSessions.afterFirstFactor(userId, method, client);
    if (outcome.kind === "challenge") return outcome;
    return { kind: "session", session: { token: outcome.token, expiresAt: outcome.expiresAt, user: await this.getUser(userId) } };
  }

  private async notifyExistingAccount(
    account: { id: string; userId: string; emailVerifiedAt: Date | null },
    email: string,
    client: ClientInfo,
  ): Promise<void> {
    if (!account.emailVerifiedAt) {
      await this.sendVerificationEmail(account.id, account.userId, email, client);
    } else if (await this.rateLimit.tryConsume(`emails:${rateLimitId(email)}`, rateLimits.emailsPerAddress)) {
      try {
        await this.emails.sendAccountExistsEmail(email, `${this.webAppUrl}/login`);
      } catch {
        // Signup stays indistinguishable when delivery fails; the sender logs provider details safely.
      }
    }
  }

  private async sendVerificationEmail(accountId: string, userId: string, email: string, client: ClientInfo) {
    // Silently capped so repeated requests can't flood an inbox or reveal anything.
    if (!(await this.rateLimit.tryConsume(`emails:${rateLimitId(email)}`, rateLimits.emailsPerAddress))) return;

    const token = generateToken();
    const verification = await this.prisma.emailVerificationToken.create({
      data: {
        emailAccountId: accountId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + verificationToken.ttlSeconds * 1000),
      },
      select: { id: true },
    });
    // The token travels in the URL fragment, which browsers never send to servers or log.
    try {
      await this.emails.sendVerificationEmail(
        email,
        `${this.webAppUrl}/verify-email#token=${token}`,
        verificationToken.ttlSeconds / 3600,
      );
    } catch {
      await this.prisma.emailVerificationToken.delete({ where: { id: verification.id } });
      return;
    }
    await this.events.record("EMAIL_VERIFICATION_SENT", { userId, client });
  }

  /**
   * Starts a password reset. The caller always gets the same result: whether the address has an
   * account, is verified or is disabled is never revealed, and the work that differs runs after
   * the response so timing doesn't reveal it either.
   */
  async forgotPassword(email: string, client: ClientInfo): Promise<void> {
    await this.rateLimit.consume(`forgot-password:ip:${client.ip}`, rateLimits.forgotPasswordPerIp);
    await this.events.record("PASSWORD_RESET_REQUESTED", { email, client });
    void this.issuePasswordReset(email).catch((error: unknown) => {
      this.logger.error(`Password reset email failed: ${toErrorMessage(error)}`);
    });
  }

  /** Emails a one-hour, single-use reset link to verified, active password accounts only. */
  private async issuePasswordReset(email: string): Promise<void> {
    const account = await this.prisma.emailAccount.findUnique({
      where: { email },
      select: { userId: true, emailVerifiedAt: true, user: { select: { status: true } } },
    });
    if (!account?.emailVerifiedAt || account.user.status !== "ACTIVE") return;
    if (!(await this.rateLimit.tryConsume(`reset-emails:${rateLimitId(email)}`, rateLimits.resetEmailsPerAddress))) return;

    const token = generateToken();
    const reset = await this.prisma.passwordResetToken.create({
      data: {
        userId: account.userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + passwordResetToken.ttlSeconds * 1000),
      },
      select: { id: true },
    });
    try {
      // Like verification links, the token travels in the URL fragment: never sent to servers or logged.
      await this.emails.sendPasswordResetEmail(
        email,
        `${this.webAppUrl}/reset-password#token=${token}`,
        passwordResetToken.ttlSeconds / 3600,
      );
    } catch {
      await this.prisma.passwordResetToken.delete({ where: { id: reset.id } });
    }
  }

  /**
   * Sets a new password with a reset token. The token is claimed, the password replaced and every
   * session revoked in one transaction, so two simultaneous attempts cannot both succeed and a
   * stolen session never survives a reset. The user is not signed in; they sign in again.
   */
  async resetPassword(token: string, password: string, client: ClientInfo): Promise<void> {
    await this.rateLimit.consume(`reset-password:ip:${client.ip}`, rateLimits.resetPasswordPerIp);
    const tokenHash = hashToken(token);

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        userId: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { status: true, emailAccount: { select: { email: true } } } },
      },
    });
    const email = record?.user.emailAccount?.email;
    if (!record || !email || record.usedAt || record.expiresAt.getTime() <= Date.now() || record.user.status !== "ACTIVE") {
      return this.failReset(client, "invalid_token", record?.userId);
    }
    if (!passwordAvoidsEmail(email, password)) {
      throw new HttpException(
        {
          code: "VALIDATION_FAILED",
          message: "Invalid request",
          issues: [{ path: "password", message: "Don't use your email in your password" }],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await this.passwords.hash(password);
    const revokedSessions = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      // Atomic claim: a concurrent request with the same token matches no row and rolls back.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;

      // Any other outstanding links for this user are no longer needed.
      await tx.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: now } });
      await tx.emailAccount.update({ where: { userId: record.userId }, data: { passwordHash }, select: { id: true } });
      const sessions = await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return sessions.count;
    });
    if (revokedSessions === null) return this.failReset(client, "invalid_token", record.userId);

    await this.events.record("PASSWORD_RESET_COMPLETED", { userId: record.userId, client, metadata: { revokedSessions } });
  }

  private async failReset(client: ClientInfo, reason: string, userId?: string): Promise<never> {
    await this.events.record("PASSWORD_RESET_FAILED", { userId, client, metadata: { reason } });
    throw new ApiError(HttpStatus.BAD_REQUEST, "PASSWORD_RESET_INVALID", "This password reset link is invalid or has expired.");
  }
}
