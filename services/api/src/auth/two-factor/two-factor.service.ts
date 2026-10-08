import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { brand } from "@repo/config";
import type { ServerConfig } from "@repo/config/server";
import type { RecoveryCodesResponse, SecurityStatus, TwoFactorSetup } from "@repo/types";
import { toErrorMessage } from "@repo/utils";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../common/api-error.ts";
import type { ClientInfo } from "../../common/client-info.ts";
import { SERVER_CONFIG } from "../../config/config.module.ts";
import { PrismaService } from "../../database/prisma.service.ts";
import { Prisma } from "../../generated/prisma/client.js";
import { RateLimitService } from "../../rate-limit/rate-limit.service.ts";
import { RedisService } from "../../redis/redis.service.ts";
import { AuthEventsService } from "../auth-events.service.ts";
import { authConfig } from "../auth.config.ts";
import { requireRecentAuth } from "../recent-auth.ts";
import { SecurityNotifier } from "../security-notifier.service.ts";
import type { AuthContext } from "../session.service.ts";
import { generateRecoveryCodes, hashRecoveryCode } from "./recovery-codes.ts";
import { SecretCipher } from "./secret-cipher.ts";
import { generateTotpSecret, matchTotp, otpauthUri } from "./totp.ts";

const { rateLimits, twoFactor } = authConfig;
const METHOD = "TOTP" as const;

type Tx = Prisma.TransactionClient;

/** Thrown inside a transaction to roll it back when a code turns out to be wrong. */
export class CodeRejected extends Error {}

/**
 * Authenticator-app two-factor: setup, enabling, verifying, recovery codes and disabling.
 *
 * The TOTP secret exists in plaintext only in memory while a code is checked. Pending setups live
 * in Redis (encrypted, keyed by the session that started them) and expire, so an abandoned setup
 * never enables anything. Every state change that must be all-or-nothing runs in one transaction.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly cipher: SecretCipher | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rateLimit: RateLimitService,
    private readonly events: AuthEventsService,
    private readonly notifier: SecurityNotifier,
    @Inject(SERVER_CONFIG) config: ServerConfig,
  ) {
    this.cipher = config.security.twoFactorKey ? new SecretCipher(config.security.twoFactorKey) : undefined;
  }

  /** Whether the server can store secrets (it has an encryption key). */
  get available(): boolean {
    return this.cipher !== undefined;
  }

  async isEnabled(userId: string): Promise<boolean> {
    return (await this.prisma.userTwoFactor.count({ where: { userId, method: METHOD } })) > 0;
  }

  async status(userId: string): Promise<SecurityStatus["twoFactor"]> {
    const config = await this.prisma.userTwoFactor.findUnique({
      where: { userId_method: { userId, method: METHOD } },
      select: { enabledAt: true },
    });
    if (!config) return { enabled: false, enabledAt: null, recoveryCodesRemaining: 0 };
    const remaining = await this.prisma.recoveryCode.count({ where: { userId, usedAt: null } });
    return { enabled: true, enabledAt: config.enabledAt.toISOString(), recoveryCodesRemaining: remaining };
  }

  /** Sensitive actions need a sign-in or reauthentication this recent, decided from the session row. */
  requireRecentAuth(auth: AuthContext): void {
    requireRecentAuth(auth);
  }

  /** Starts setup: makes a secret and parks it, encrypted, until the person proves their app works. */
  async startSetup(auth: AuthContext, client: ClientInfo): Promise<TwoFactorSetup> {
    const cipher = this.requireCipher();
    await this.rateLimit.consume(`2fa-setup:user:${auth.userId}`, rateLimits.twoFactorSetupPerUser);
    if (await this.isEnabled(auth.userId)) {
      throw new ApiError(HttpStatus.CONFLICT, "TWO_FACTOR_ALREADY_ENABLED", "Two-factor authentication is already on");
    }

    const secret = generateTotpSecret();
    await this.redis.client.set(
      setupKey(auth.sessionId),
      JSON.stringify({ userId: auth.userId, secret: cipher.encrypt(secret, setupContext(auth.userId)) }),
      "EX",
      twoFactor.setupTtlSeconds,
    );
    await this.events.record("TWO_FACTOR_SETUP_STARTED", { userId: auth.userId, sessionId: auth.sessionId, client });

    return { otpauthUri: otpauthUri({ secret, issuer: brand.name, account: await this.accountLabel(auth.userId) }), secret, expiresInSeconds: twoFactor.setupTtlSeconds };
  }

  /**
   * Enables two-factor once a valid code from the pending secret is presented. Missing, expired, wrong
   * and replayed setups all answer the same way. Returns the recovery codes, to be shown once.
   */
  async confirmSetup(auth: AuthContext, code: string, client: ClientInfo): Promise<RecoveryCodesResponse> {
    const cipher = this.requireCipher();
    await this.rateLimit.consume(`2fa-confirm:user:${auth.userId}`, rateLimits.twoFactorConfirmPerUser);

    const reject = async (reason: string): Promise<never> => {
      await this.events.record("TWO_FACTOR_FAILED", { userId: auth.userId, sessionId: auth.sessionId, client, metadata: { stage: "setup", reason } });
      throw invalidCode();
    };

    const raw = await this.redis.client.get(setupKey(auth.sessionId));
    if (!raw) return reject("no_pending_setup");
    const pending = JSON.parse(raw) as { userId: string; secret: string };
    // Defence in depth: the key already includes this session, which belongs to one user.
    if (pending.userId !== auth.userId) return reject("setup_owner_mismatch");

    const secret = cipher.decrypt(pending.secret, setupContext(auth.userId));
    const step = matchTotp(secret, code);
    if (step === null) return reject("invalid_code");

    // Atomic claim of the pending setup: only one of several simultaneous confirmations gets 1.
    if ((await this.redis.client.del(setupKey(auth.sessionId))) !== 1) return reject("setup_already_used");

    const codes = generateRecoveryCodes();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.userTwoFactor.create({
          data: { userId: auth.userId, method: METHOD, encryptedSecret: cipher.encrypt(secret, totpContext(auth.userId)), lastUsedStep: step },
          select: { id: true },
        });
        await this.storeRecoveryCodes(tx, auth.userId, codes);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiError(HttpStatus.CONFLICT, "TWO_FACTOR_ALREADY_ENABLED", "Two-factor authentication is already on");
      }
      throw error;
    }

    await this.events.record("TWO_FACTOR_ENABLED", { userId: auth.userId, sessionId: auth.sessionId, client });
    await this.events.record("RECOVERY_CODES_GENERATED", { userId: auth.userId, sessionId: auth.sessionId, client, metadata: { count: codes.length } });
    this.notifier.notify(auth.userId, "two_factor_enabled", client);
    return { recoveryCodes: codes };
  }

  /** Turns two-factor off. Needs a recent authentication and a current authenticator code. */
  async disable(auth: AuthContext, code: string, client: ClientInfo): Promise<void> {
    await this.guardManagement(auth);
    await this.prisma
      .$transaction(async (tx) => {
        await this.requireValidCode(tx, auth, code, client);
        await tx.recoveryCode.deleteMany({ where: { userId: auth.userId } });
        await tx.userTwoFactor.delete({ where: { userId_method: { userId: auth.userId, method: METHOD } }, select: { id: true } });
      })
      .catch(rethrowRejected);

    await this.events.record("TWO_FACTOR_DISABLED", { userId: auth.userId, sessionId: auth.sessionId, client });
    this.notifier.notify(auth.userId, "two_factor_disabled", client);
  }

  /** Replaces the whole recovery-code set. Needs a recent authentication and a current authenticator code. */
  async regenerateRecoveryCodes(auth: AuthContext, code: string, client: ClientInfo): Promise<RecoveryCodesResponse> {
    await this.guardManagement(auth);
    const codes = generateRecoveryCodes();
    await this.prisma
      .$transaction(async (tx) => {
        await this.requireValidCode(tx, auth, code, client);
        await tx.recoveryCode.deleteMany({ where: { userId: auth.userId } });
        await this.storeRecoveryCodes(tx, auth.userId, codes);
      })
      .catch(rethrowRejected);

    await this.events.record("RECOVERY_CODES_REGENERATED", { userId: auth.userId, sessionId: auth.sessionId, client, metadata: { count: codes.length } });
    this.notifier.notify(auth.userId, "recovery_codes_regenerated", client);
    return { recoveryCodes: codes };
  }

  /**
   * Checks an authenticator code and burns its time step, so the same code can't be used twice (here
   * or anywhere else). Runs in the caller's transaction when one is given.
   */
  async verifyTotp(userId: string, code: string, tx: Tx | PrismaService = this.prisma): Promise<boolean> {
    const config = await tx.userTwoFactor.findUnique({
      where: { userId_method: { userId, method: METHOD } },
      select: { encryptedSecret: true },
    });
    if (!config) return false;

    let secret: string;
    try {
      secret = this.requireCipher().decrypt(config.encryptedSecret, totpContext(userId));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // A wrong key or damaged value: nothing here can be verified, and guessing would be unsafe.
      this.logger.error(`Could not decrypt a two-factor secret: ${toErrorMessage(error)}`);
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", "Service temporarily unavailable");
    }
    const step = matchTotp(secret, code);
    if (step === null) return false;

    const { count } = await tx.userTwoFactor.updateMany({
      where: { userId, method: METHOD, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
      data: { lastUsedStep: step },
    });
    return count === 1;
  }

  /** Atomically uses up one recovery code; false if it's unknown, belongs to someone else or was used. */
  async claimRecoveryCode(userId: string, normalizedCode: string, tx: Tx | PrismaService = this.prisma): Promise<boolean> {
    const { count } = await tx.recoveryCode.updateMany({
      where: { userId, codeHash: hashRecoveryCode(normalizedCode), usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  private async guardManagement(auth: AuthContext): Promise<void> {
    this.requireRecentAuth(auth);
    await this.rateLimit.consume(`2fa-manage:user:${auth.userId}`, rateLimits.twoFactorManagePerUser);
    if (!(await this.isEnabled(auth.userId))) {
      throw new ApiError(HttpStatus.CONFLICT, "TWO_FACTOR_NOT_ENABLED", "Two-factor authentication is not on");
    }
  }

  private async requireValidCode(tx: Tx, auth: AuthContext, code: string, client: ClientInfo): Promise<void> {
    if (await this.verifyTotp(auth.userId, code, tx)) return;
    // Recorded after the rollback would be lost, so record on the main connection.
    await this.events.record("TWO_FACTOR_FAILED", { userId: auth.userId, sessionId: auth.sessionId, client, metadata: { stage: "management" } });
    throw new CodeRejected();
  }

  private async storeRecoveryCodes(tx: Tx, userId: string, codes: string[]): Promise<void> {
    const generation = randomUUID();
    await tx.recoveryCode.createMany({
      data: codes.map((code) => ({ userId, generation, codeHash: hashRecoveryCode(code.replaceAll("-", "")) })),
    });
  }

  private async accountLabel(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { userNumber: true, emailAccount: { select: { email: true } }, oAuthIdentities: { select: { emailAtLinkTime: true } } },
    });
    return user.emailAccount?.email ?? user.oAuthIdentities[0]?.emailAtLinkTime ?? `user-${user.userNumber}`;
  }

  private requireCipher(): SecretCipher {
    if (!this.cipher) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", "Two-factor authentication is not available");
    }
    return this.cipher;
  }
}

const setupKey = (sessionId: string) => `2fa:setup:${sessionId}`;
const setupContext = (userId: string) => `totp-setup:${userId}`;
const totpContext = (userId: string) => `totp:${userId}`;

function invalidCode(): ApiError {
  return new ApiError(HttpStatus.BAD_REQUEST, "TWO_FACTOR_CODE_INVALID", "That code didn't work. Check your authenticator app and try again.");
}

function rethrowRejected(error: unknown): never {
  throw error instanceof CodeRejected ? new ApiError(HttpStatus.BAD_REQUEST, "TWO_FACTOR_CODE_INVALID", "That code didn't work. Check your authenticator app and try again.") : error;
}
