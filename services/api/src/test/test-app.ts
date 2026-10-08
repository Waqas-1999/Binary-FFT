import { ConsoleLogger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { loadServerConfig } from "@repo/config/server";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { AppModule } from "../app.module.ts";
import { GOOGLE_OAUTH_CLIENT, type GoogleIdentity, type GoogleOAuthClient } from "../auth/oauth/google.client.ts";
import { configureApp } from "../app.setup.ts";
import { PrismaService } from "../database/prisma.service.ts";
import { SMS_PROVIDER, type SmsProvider, type VerificationSms } from "../profile/sms/sms.provider.ts";
import { TELEGRAM_CLIENT, type TelegramClient } from "../profile/telegram/telegram.client.ts";
import { EMAIL_SENDER, type EmailMessage, type EmailSender, LogEmailSender } from "../email/email.sender.ts";
import { RedisService } from "../redis/redis.service.ts";

export const ORIGIN = "http://localhost:3000";

/** Records sent emails and still exercises the real log adapter (without bodies, as outside development). */
class CapturingEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  private readonly log = new LogEmailSender();
  private nextFailure: Error | undefined;

  failNext(error: Error): void {
    this.nextFailure = error;
  }

  async send(message: EmailMessage): Promise<void> {
    if (this.nextFailure) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      throw error;
    }
    this.sent.push(message);
    await this.log.send(message);
  }
}

/** Records SMS codes instead of sending them. Test-only: the real providers never expose a code. */
export class CapturingSmsProvider implements SmsProvider {
  readonly configured: boolean = true;
  readonly sent: VerificationSms[] = [];
  private nextFailure: Error | undefined;

  failNext(error: Error): void {
    this.nextFailure = error;
  }

  async sendVerificationCode(sms: VerificationSms): Promise<void> {
    if (this.nextFailure) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      throw error;
    }
    this.sent.push(sms);
  }

  /** The code in the latest text to `to`. */
  latestCode(to: string): string {
    const sms = this.sent.findLast((message) => message.to === to);
    if (!sms) throw new Error(`No SMS sent to ${to}`);
    return sms.code;
  }
}

/** Records messages the bot would send. */
export class FakeTelegram implements TelegramClient {
  readonly messages: { chatId: string; text: string }[] = [];
  private nextFailure: Error | undefined;

  failNext(error: Error): void {
    this.nextFailure = error;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (this.nextFailure) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      throw error;
    }
    this.messages.push({ chatId, text });
  }
}

/**
 * Stands in for Google. Like the real thing it only redeems a code once, for the client that asked,
 * and only with the PKCE verifier and nonce that match what the authorization request carried.
 */
export class FakeGoogle implements GoogleOAuthClient {
  private readonly authorizations = new Map<string, { nonce: string; codeChallenge: string }>();
  private readonly codes = new Map<string, { identity: GoogleIdentity; nonce: string; codeChallenge: string }>();
  readonly seen: { code: string; codeVerifier: string; nonce: string }[] = [];

  authorizationUrl(params: { state: string; nonce: string; codeChallenge: string }): string {
    this.authorizations.set(params.state, params);
    return `https://accounts.google.test/auth?state=${params.state}&nonce=${params.nonce}&code_challenge=${params.codeChallenge}&code_challenge_method=S256`;
  }

  /** The user approves at Google: returns the authorization code for the flow started with `state`. */
  approve(state: string, identity: GoogleIdentity): string {
    const authorization = this.authorizations.get(state);
    if (!authorization) throw new Error("Unknown state: no authorization request was made with it");
    const code = `code-${this.codes.size + 1}-${state.slice(0, 6)}`;
    this.codes.set(code, { identity, ...authorization });
    return code;
  }

  async identify(params: { code: string; codeVerifier: string; nonce: string }): Promise<GoogleIdentity> {
    this.seen.push(params);
    const grant = this.codes.get(params.code);
    this.codes.delete(params.code);
    if (!grant) throw new Error("invalid_grant");
    if (createHash("sha256").update(params.codeVerifier).digest("base64url") !== grant.codeChallenge) {
      throw new Error("PKCE verification failed");
    }
    if (params.nonce !== grant.nonce) throw new Error("nonce mismatch");
    return grant.identity;
  }

  clear(): void {
    this.authorizations.clear();
    this.codes.clear();
    this.seen.length = 0;
  }
}

export interface TestApp {
  app: NestExpressApplication;
  url: string;
  prisma: PrismaService;
  redis: RedisService;
  emails: CapturingEmailSender;
  google: FakeGoogle;
  sms: CapturingSmsProvider;
  telegram: FakeTelegram;
  request(
    path: string,
    init?: {
      method?: string;
      body?: unknown;
      cookie?: string;
      origin?: string | null;
      headers?: Record<string, string>;
      /** Use "manual" to inspect redirects instead of following them. */
      redirect?: "manual" | "follow";
    },
  ): Promise<Response>;
  /** Extracts the verification token from the latest email to `to`. */
  verificationToken(to: string): string;
  /** Extracts the password reset token from the latest reset email to `to`. */
  resetToken(to: string): string;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const emails = new CapturingEmailSender();
  const google = new FakeGoogle();
  const sms = new CapturingSmsProvider();
  const telegram = new FakeTelegram();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMAIL_SENDER)
    .useValue(emails)
    .overrideProvider(GOOGLE_OAUTH_CLIENT)
    .useValue(google)
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .overrideProvider(TELEGRAM_CLIENT)
    .useValue(telegram)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  // Real JSON logger with no redaction, so tests prove secrets are never passed to the logger at all.
  app.useLogger(new ConsoleLogger({ json: true, colors: false }));
  configureApp(app, loadServerConfig());
  await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);

  return {
    app,
    url,
    prisma,
    redis,
    emails,
    google,
    sms,
    telegram,
    request(path, { method = "GET", body, cookie, origin = ORIGIN, headers: extra, redirect = "follow" } = {}) {
      const headers: Record<string, string> = { ...extra };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (cookie) headers.cookie = cookie;
      if (origin) headers.origin = origin;
      return fetch(`${url}/api/v1${path}`, {
        method,
        headers,
        redirect,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    verificationToken(to) {
      const message = emails.sent.findLast((email) => email.to === to && email.text.includes("#token="));
      const token = message?.text.match(/#token=([\w-]+)/)?.[1];
      if (!token) throw new Error(`No verification email for ${to}`);
      return token;
    },
    resetToken(to) {
      const message = emails.sent.findLast((email) => email.to === to && email.text.includes("/reset-password#token="));
      const token = message?.text.match(/#token=([\w-]+)/)?.[1];
      if (!token) throw new Error(`No password reset email for ${to}`);
      return token;
    },
    async reset() {
      emails.sent.length = 0;
      google.clear();
      sms.sent.length = 0;
      telegram.messages.length = 0;
      // Guard against ever truncating a non-test database.
      const [{ name }] = await prisma.$queryRaw<[{ name: string }]>`SELECT current_database() AS name`;
      if (!name.endsWith("_test")) throw new Error(`Refusing to reset non-test database "${name}"`);
      await prisma.$executeRawUnsafe(
        'TRUNCATE "auth_events", "sessions", "email_verification_tokens", "password_reset_tokens", "o_auth_identities", "recovery_codes", "auth_challenges", "user_two_factor", "user_phones", "phone_verification_challenges", "telegram_connections", "telegram_link_tokens", "notification_preferences", "email_accounts", "users"',
      );
      if (redis.client.options.db !== 15) throw new Error("Refusing to flush a non-test Redis database");
      await redis.client.flushdb();
    },
    close: () => app.close(),
  };
}

/** Returns the `name=value` pair of the session cookie from a response, for use in a Cookie header. */
export function sessionCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("session="))
    ?.split(";")[0];
}

/** Returns the `name=value` pair of a cookie set by a response, for use in a Cookie header. */
export function responseCookie(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(";")[0];
}
