import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { ServerConfig } from "@repo/config/server";
import type { AuthUser } from "@repo/types";
import type { LoginInput, SignupInput } from "@repo/validation";
import { ApiError } from "../common/api-error.ts";
import type { ClientInfo } from "../common/client-info.ts";
import { SERVER_CONFIG } from "../config/config.module.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { EmailService } from "../email/email.service.ts";
import { Prisma } from "../generated/prisma/client.js";
import { RateLimitService, rateLimitId } from "../rate-limit/rate-limit.service.ts";
import { AuthEventsService } from "./auth-events.service.ts";
import { authConfig } from "./auth.config.ts";
import { PasswordService } from "./password.service.ts";
import { SessionService } from "./session.service.ts";
import { generateToken, hashToken } from "./tokens.ts";

export interface NewSession {
  token: string;
  expiresAt: Date;
  user: AuthUser;
}

const { rateLimits, verificationToken } = authConfig;

@Injectable()
export class AuthService {
  private readonly webAppUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly events: AuthEventsService,
    private readonly emails: EmailService,
    private readonly rateLimit: RateLimitService,
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
  async verifyEmail(token: string, client: ClientInfo): Promise<NewSession> {
    await this.rateLimit.consume(`verify:ip:${client.ip}`, rateLimits.verifyPerIp);
    const tokenHash = hashToken(token);
    const now = new Date();

    // Atomic claim: concurrent requests with the same token cannot both succeed.
    const claimed = await this.prisma.emailVerificationToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      throw new Error("VERIFICATION_LINK_INVALID");
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
      throw new Error("VERIFICATION_LINK_INVALID");
    }
    return this.startSession(account.userId, { userNumber: account.user.userNumber, email: account.email, emailVerified: true }, client, "email_verification");
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
      select: { userNumber: true, emailAccount: { select: { email: true, emailVerifiedAt: true } } },
    });
    return {
      userNumber: user.userNumber,
      email: user.emailAccount?.email ?? "",
      emailVerified: Boolean(user.emailAccount?.emailVerifiedAt),
    };
  }

  private async startSession(
    userId: string,
    user: AuthUser,
    client: ClientInfo,
    method: "password" | "email_verification",
  ): Promise<NewSession> {
    const session = await this.sessions.create(userId, client);
    await this.events.record("LOGIN_SUCCESS", { userId, sessionId: session.sessionId, client, metadata: { method } });
    return { token: session.token, expiresAt: session.expiresAt, user };
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

  /** Initiates password reset for an email address. Always returns success to avoid leaking account existence. */
  async forgotPassword(email: string, client: ClientInfo): Promise<void> {
    // Always respond the same way to avoid leaking whether an email exists
    await this.rateLimit.consume(`forgot-password:ip:${client.ip}`, authConfig.rateLimits.forgotPasswordPerIp);
    await this.events.record("PASSWORD_RESET_REQUESTED", { email, client });

    const normalizedEmail = email.trim().toLowerCase();
    const account = await this.prisma.emailAccount.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, userId: true, user: { select: { id: true, status: true } } },
    });

    // Only proceed if we have a verified, active email/password account
    if (account && account.user.status === "ACTIVE" && account.emailVerifiedAt) {
      // Create a password reset token (only hash is stored)
      const token = generateToken();
      const tokenHash = hashToken(token);
      try {
        await this.prisma.passwordResetToken.create({
          data: {
            userId: account.userId,
            tokenHash,
            expiresAt: new Date(Date.now() + authConfig.rateLimits.resetPasswordPerIp.windowSeconds * 1000),
          },
        });

        // Send the reset email with the token in the URL fragment
        try {
          await this.emails.sendPasswordResetEmail(
            normalizedEmail,
            `${this.webAppUrl}/reset-password#token=${token}`,
            authConfig.rateLimits.resetPasswordPerIp.windowSeconds / 3600,
          );
        } catch {
          // If email fails, clean up the token and don't leak that via the response
          await this.prisma.passwordResetToken.deleteMany({
            where: { userId: account.userId, tokenHash },
          });
          return;
        }

        await this.events.record("PASSWORD_RESET_SENT", { userId: account.userId, client });
      } catch (error) {
        // If token creation fails (e.g. unique constraint), silently continue
        // The generic response prevents leaking information about why it failed
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
          throw error;
        }
      }
    }
    // Always return success regardless of whether the email exists or is eligible
  }

  /** Completes password reset using a token and new password. */
  async resetPassword(
    token: string,
    newPassword: string,
    client: ClientInfo,
  ): Promise<{ userId: string; userNumber: number }> {
    await this.rateLimit.consume(`reset-password:ip:${client.ip}`, authConfig.rateLimits.resetPasswordPerIp);
    const tokenHash = hashToken(token);
    const now = new Date();

    // Atomic consumption: ensures the token can only be used once
    const updateResult = await this.prisma.passwordResetToken.updateMany({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    if (updateResult.count !== 1) {
      // Token not found, expired, or already used
      await this.events.record("PASSWORD_RESET_FAILED", {
        client,
        metadata: { reason: "invalid_or_expired_token" },
      });
      throw new Error("PASSWORD_RESET_INVALID");
    }

    const resetToken = await this.prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash },
      select: {
        userId: true,
        user: {
          select: {
            userNumber: true,
            status: true,
            emailAccount: { select: { id: true, email: true, emailVerifiedAt: true } },
          },
        },
      },
    });

    // Verify the user is still active
    if (resetToken.user.status !== "ACTIVE") {
      await this.events.record("PASSWORD_RESET_FAILED", {
        userId: resetToken.userId,
        client,
        metadata: { reason: "account_disabled" },
      });
      throw new Error("PASSWORD_RESET_INVALID");
    }

    // Validate the new password against the policy
    if (newPassword.length < 10) {
      throw new Error("VALIDATION_FAILED");
    }
    if (newPassword.length > 128) {
      throw new Error("VALIDATION_FAILED");
    }

    // Hash the new password
    const newPasswordHash = await this.passwords.hash(newPassword);

    // Update the password hash and revoke all existing sessions for the user in a transaction
    await this.prisma.$transaction([
      this.prisma.emailAccount.update({
        where: { userId: resetToken.userId },
        data: { passwordHash: newPasswordHash },
      }),
      this.prisma.session.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.events.record("PASSWORD_RESET_COMPLETED", {
      userId: resetToken.userId,
    });

    return {
      userId: resetToken.userId,
      userNumber: resetToken.user.userNumber,
    };
  }
}