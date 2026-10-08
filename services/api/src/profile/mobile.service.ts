import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { PhoneCodeSentResponse } from "@repo/types";
import { maskPhoneNumber } from "@repo/validation";
import { randomInt } from "node:crypto";
import { AuthEventsService } from "../auth/auth-events.service.ts";
import { requireRecentAuth } from "../auth/recent-auth.ts";
import type { AuthContext } from "../auth/session.service.ts";
import { hashToken } from "../auth/tokens.ts";
import { ApiError } from "../common/api-error.ts";
import type { ClientInfo } from "../common/client-info.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { RateLimitService, rateLimitId } from "../rate-limit/rate-limit.service.ts";
import { profileConfig } from "./profile.config.ts";
import { SMS_PROVIDER, type SmsProvider } from "./sms/sms.provider.ts";

const { phone, rateLimits } = profileConfig;

/** Thrown inside the verification transaction to roll it back when the code is wrong. */
class CodeRejected extends Error {}

/**
 * Optional mobile number with SMS verification. The number is stored on the user only after the code is
 * confirmed; until then it lives in a single pending challenge that a newer request replaces. Codes are
 * random, short-lived, single-use, attempt-limited and stored only as hashes.
 */
@Injectable()
export class MobileService {
  private readonly logger = new Logger(MobileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AuthEventsService,
    private readonly rateLimit: RateLimitService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /** Starts (or restarts) verification of a number: replaces any pending challenge and texts a new code. */
  async requestCode(auth: AuthContext, phoneNumber: string, client: ClientInfo): Promise<PhoneCodeSentResponse> {
    if (!this.sms.configured) throw unavailable();
    requireRecentAuth(auth);

    const sent = (status: PhoneCodeSentResponse["status"]): PhoneCodeSentResponse => ({
      status,
      expiresInSeconds: phone.codeTtlSeconds,
      resendAfterSeconds: phone.resendAfterSeconds,
    });

    const current = await this.prisma.userPhone.findUnique({ where: { userId: auth.userId }, select: { phoneNumber: true } });
    if (current?.phoneNumber === phoneNumber) return sent("already_verified");

    await this.rateLimit.consume(`phone-otp-cooldown:user:${auth.userId}`, rateLimits.phoneCooldown);
    await this.rateLimit.consume(`phone-otp:user:${auth.userId}`, rateLimits.phoneCodesPerUser);

    const pending = await this.prisma.phoneVerificationChallenge.findUnique({
      where: { userId: auth.userId },
      select: { phoneNumber: true, consumedAt: true, expiresAt: true },
    });
    const isResend = pending && !pending.consumedAt && pending.expiresAt.getTime() > Date.now() && pending.phoneNumber === phoneNumber;
    if (!isResend) await this.rateLimit.consume(`phone-change:user:${auth.userId}`, rateLimits.phoneChangesPerUser);

    // Silent cap per destination number: it must never reveal that another account used the number.
    const mayText = await this.rateLimit.tryConsume(`phone-otp:number:${rateLimitId(phoneNumber)}`, rateLimits.phoneCodesPerNumber);

    const code = generateCode();
    const now = new Date();
    const fields = {
      phoneNumber,
      codeHash: hashCode(auth.userId, phoneNumber, code),
      attempts: 0,
      expiresAt: new Date(now.getTime() + phone.codeTtlSeconds * 1000),
      consumedAt: null,
      createdAt: now,
    };
    // One row per user: replacing it is what makes every earlier code (and number) stop working.
    await this.prisma.phoneVerificationChallenge.upsert({
      where: { userId: auth.userId },
      create: { userId: auth.userId, ...fields },
      update: fields,
      select: { id: true },
    });
    await this.events.record("PHONE_VERIFICATION_REQUESTED", {
      userId: auth.userId,
      sessionId: auth.sessionId,
      client,
      metadata: { mobile: maskPhoneNumber(phoneNumber), capped: !mayText },
    });

    if (mayText) {
      try {
        await this.sms.sendVerificationCode({ to: phoneNumber, code, expiresInMinutes: phone.codeTtlSeconds / 60 });
      } catch (error) {
        // Provider errors can echo the destination number or the code, so only the error type is logged.
        this.logger.error(`SMS verification code not sent (${error instanceof Error ? error.name : "unknown error"})`);
        throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", "Service temporarily unavailable");
      }
    }
    return sent("code_sent");
  }

  /** Confirms the code. The claim and the number change happen together or not at all. */
  async verify(auth: AuthContext, code: string, client: ClientInfo): Promise<void> {
    await this.rateLimit.consume(`phone-verify:user:${auth.userId}`, rateLimits.phoneVerifyPerUser);

    const challenge = await this.prisma.phoneVerificationChallenge.findUnique({ where: { userId: auth.userId } });
    const usable =
      challenge &&
      !challenge.consumedAt &&
      challenge.expiresAt.getTime() > Date.now() &&
      challenge.attempts < phone.maxAttempts;
    if (!usable) return this.reject(auth, client, "no_active_code");

    const codeHash = hashCode(auth.userId, challenge.phoneNumber, code);
    let replaced = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.phoneVerificationChallenge.updateMany({
          where: {
            id: challenge.id,
            consumedAt: null,
            expiresAt: { gt: new Date() },
            attempts: { lt: phone.maxAttempts },
            codeHash,
          },
          data: { consumedAt: new Date() },
        });
        if (claimed.count !== 1) throw new CodeRejected();

        const previous = await tx.userPhone.findUnique({ where: { userId: auth.userId }, select: { phoneNumber: true } });
        replaced = Boolean(previous);
        await tx.userPhone.upsert({
          where: { userId: auth.userId },
          create: { userId: auth.userId, phoneNumber: challenge.phoneNumber },
          update: { phoneNumber: challenge.phoneNumber, verifiedAt: new Date() },
          select: { id: true },
        });
      });
    } catch (error) {
      if (!(error instanceof CodeRejected)) throw error;
      await this.prisma.phoneVerificationChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { attempts: { increment: 1 } },
      });
      return this.reject(auth, client, "wrong_code");
    }

    await this.events.record(replaced ? "PHONE_CHANGED" : "PHONE_VERIFIED", {
      userId: auth.userId,
      sessionId: auth.sessionId,
      client,
      metadata: { mobile: maskPhoneNumber(challenge.phoneNumber) },
    });
  }

  /** Removes the number and any pending verification. */
  async remove(auth: AuthContext, client: ClientInfo): Promise<void> {
    requireRecentAuth(auth);
    await this.rateLimit.consume(`phone-remove:user:${auth.userId}`, rateLimits.phoneRemovePerUser);

    const removed = await this.prisma.$transaction(async (tx) => {
      await tx.phoneVerificationChallenge.deleteMany({ where: { userId: auth.userId } });
      return (await tx.userPhone.deleteMany({ where: { userId: auth.userId } })).count;
    });
    if (removed > 0) {
      await this.events.record("PHONE_REMOVED", { userId: auth.userId, sessionId: auth.sessionId, client });
    }
  }

  private async reject(auth: AuthContext, client: ClientInfo, reason: string): Promise<never> {
    await this.events.record("PHONE_VERIFICATION_FAILED", { userId: auth.userId, sessionId: auth.sessionId, client, metadata: { reason } });
    // Missing, expired, used up and wrong all answer the same.
    throw new ApiError(HttpStatus.BAD_REQUEST, "PHONE_CODE_INVALID", "That code didn't work. Check it and try again.");
  }
}

/** Uniformly random six digits from the OS CSPRNG. */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Bound to the user and the number, so a code for one cannot confirm the other. */
function hashCode(userId: string, phoneNumber: string, code: string): string {
  return hashToken(`phone-otp:${userId}:${phoneNumber}:${code}`);
}

function unavailable(): ApiError {
  return new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "FEATURE_UNAVAILABLE", "Mobile verification is not available");
}
