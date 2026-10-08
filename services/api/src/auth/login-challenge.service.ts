import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { ServerConfig } from "@repo/config/server";
import type { CookieOptions, Request, Response } from "express";
import { ApiError } from "../common/api-error.ts";
import { type ClientInfo, readCookie } from "../common/client-info.ts";
import { SERVER_CONFIG } from "../config/config.module.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { RateLimitService } from "../rate-limit/rate-limit.service.ts";
import { AuthEventsService } from "./auth-events.service.ts";
import { authConfig, challengeCookieName } from "./auth.config.ts";
import { generateToken, hashToken } from "./tokens.ts";
import { CodeRejected, TwoFactorService } from "./two-factor/two-factor.service.ts";

const { rateLimits, twoFactor } = authConfig;

export type SecondFactor = { kind: "totp" | "recovery"; code: string };

export interface CompletedChallenge {
  userId: string;
  /** How the first factor was passed: "password", "email_verification" or "google". */
  method: string;
}

/** Thrown inside a transaction to roll it back when the challenge was used up by someone else. */
class ChallengeGone extends Error {}

/**
 * A sign-in that passed its first factor but isn't a session yet. The challenge token lives only in an
 * HttpOnly cookie (so it is bound to the browser that signed in) and only its hash is stored. A
 * challenge is short-lived, single-use and dies after a few wrong codes.
 */
@Injectable()
export class LoginChallengeService {
  private readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly prisma: PrismaService,
    private readonly twoFactor: TwoFactorService,
    private readonly rateLimit: RateLimitService,
    private readonly events: AuthEventsService,
    @Inject(SERVER_CONFIG) config: ServerConfig,
  ) {
    this.cookieName = challengeCookieName(config.app.isProduction);
    this.cookieOptions = { httpOnly: true, secure: config.app.isProduction, sameSite: "lax", path: "/" };
  }

  async create(userId: string, method: string): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + twoFactor.challengeTtlSeconds * 1000);
    await this.prisma.authChallenge.create({
      data: { userId, purpose: "LOGIN_2FA", tokenHash: hashToken(token), method, expiresAt },
      select: { id: true },
    });
    return { token, expiresAt };
  }

  /**
   * Checks the second factor and consumes the challenge in one transaction, so the challenge and the
   * code (or recovery code) are used together or not at all. Every failure looks the same to the caller.
   */
  async complete(token: string | undefined, factor: SecondFactor, client: ClientInfo): Promise<CompletedChallenge> {
    await this.rateLimit.consume(`2fa-verify:ip:${client.ip}`, rateLimits.twoFactorVerifyPerIp);

    const challenge = token
      ? await this.prisma.authChallenge.findUnique({
          where: { tokenHash: hashToken(token) },
          select: { id: true, userId: true, method: true, attempts: true, expiresAt: true, consumedAt: true, user: { select: { status: true } } },
        })
      : null;
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt.getTime() <= Date.now() ||
      challenge.attempts >= twoFactor.maxChallengeAttempts ||
      challenge.user.status !== "ACTIVE"
    ) {
      throw challengeInvalid();
    }
    await this.rateLimit.consume(`2fa-verify:user:${challenge.userId}`, rateLimits.twoFactorVerifyPerUser);

    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.authChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: twoFactor.maxChallengeAttempts } },
          data: { consumedAt: new Date() },
        });
        if (claimed.count !== 1) throw new ChallengeGone();

        const ok =
          factor.kind === "totp"
            ? await this.twoFactor.verifyTotp(challenge.userId, factor.code, tx)
            : await this.twoFactor.claimRecoveryCode(challenge.userId, factor.code, tx);
        if (!ok) throw new CodeRejected();
      });
    } catch (error) {
      if (error instanceof ChallengeGone) throw challengeInvalid();
      if (!(error instanceof CodeRejected)) throw error;

      // The transaction rolled back, so the challenge is still usable; count the miss against it.
      await this.prisma.authChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } }, select: { id: true } });
      await this.events.record("TWO_FACTOR_FAILED", { userId: challenge.userId, client, metadata: { stage: "login", factor: factor.kind } });
      throw new ApiError(HttpStatus.UNAUTHORIZED, "TWO_FACTOR_CODE_INVALID", "That code didn't work. Try again.");
    }

    if (factor.kind === "recovery") {
      await this.events.record("RECOVERY_CODE_USED", { userId: challenge.userId, client });
    }
    return { userId: challenge.userId, method: challenge.method };
  }

  readToken(req: Request): string | undefined {
    return readCookie(req, this.cookieName);
  }

  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.cookieName, token, { ...this.cookieOptions, expires: expiresAt });
  }

  clearCookie(res: Response): void {
    res.clearCookie(this.cookieName, this.cookieOptions);
  }
}

function challengeInvalid(): ApiError {
  return new ApiError(HttpStatus.UNAUTHORIZED, "TWO_FACTOR_CHALLENGE_INVALID", "Your sign-in expired. Please sign in again.");
}
