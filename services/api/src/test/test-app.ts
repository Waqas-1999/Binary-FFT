import { ConsoleLogger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { loadServerConfig } from "@repo/config/server";
import type { AddressInfo } from "node:net";
import { AppModule } from "../app.module.ts";
import { configureApp } from "../app.setup.ts";
import { PrismaService } from "../database/prisma.service.ts";
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

export interface TestApp {
  app: NestExpressApplication;
  url: string;
  prisma: PrismaService;
  redis: RedisService;
  emails: CapturingEmailSender;
  request(
    path: string,
    init?: { method?: string; body?: unknown; cookie?: string; origin?: string | null; headers?: Record<string, string> },
  ): Promise<Response>;
  /** Extracts the verification token from the latest email to `to`. */
  verificationToken(to: string): string;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const emails = new CapturingEmailSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMAIL_SENDER)
    .useValue(emails)
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
    request(path, { method = "GET", body, cookie, origin = ORIGIN, headers: extra } = {}) {
      const headers: Record<string, string> = { ...extra };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (cookie) headers.cookie = cookie;
      if (origin) headers.origin = origin;
      return fetch(`${url}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    },
    verificationToken(to) {
      const message = emails.sent.findLast((email) => email.to === to && email.text.includes("#token="));
      const token = message?.text.match(/#token=([\w-]+)/)?.[1];
      if (!token) throw new Error(`No verification email for ${to}`);
      return token;
    },
    async reset() {
      emails.sent.length = 0;
      // Guard against ever truncating a non-test database.
      const [{ name }] = await prisma.$queryRaw<[{ name: string }]>`SELECT current_database() AS name`;
      if (!name.endsWith("_test")) throw new Error(`Refusing to reset non-test database "${name}"`);
      await prisma.$executeRawUnsafe(
        'TRUNCATE "auth_events", "sessions", "email_verification_tokens", "email_accounts", "users"',
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
