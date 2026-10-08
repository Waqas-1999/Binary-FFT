import { brand } from "@repo/config";
import type { ApiErrorResponse } from "@repo/types";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "../test/test-app.ts";
import { hashToken } from "./tokens.ts";

const EMAIL = "alex@example.com";
const PASSWORD = "calm-river-sunrise-42";
const NEW_PASSWORD = "brand-new-lantern-77";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const forgot = (email = EMAIL) => t.request("/auth/forgot-password", { method: "POST", body: { email } });
const reset = (token: string, password = NEW_PASSWORD) =>
  t.request("/auth/reset-password", { method: "POST", body: { token, password } });
const login = (email = EMAIL, password = PASSWORD) =>
  t.request("/auth/login", { method: "POST", body: { email, password } });
const errorCode = async (response: Response) => ((await response.json()) as ApiErrorResponse).code;

/** Creates a verified password account and returns its first session cookie. */
async function verifiedUser(email = EMAIL): Promise<string> {
  await t.request("/auth/signup", { method: "POST", body: { email, password: PASSWORD } });
  const response = await t.request("/auth/verify-email", { method: "POST", body: { token: t.verificationToken(email) } });
  return sessionCookie(response)!;
}

/** The reset email is sent after the response, so wait for it. */
async function requestReset(email = EMAIL): Promise<string> {
  const before = t.emails.sent.length;
  expect((await forgot(email)).status).toBe(202);
  await vi.waitFor(() => expect(t.emails.sent.length).toBeGreaterThan(before));
  return t.resetToken(email);
}

describe("forgot password", () => {
  it("emails a reset link with the token in the URL fragment only", async () => {
    await verifiedUser();
    t.emails.sent.length = 0;
    const token = await requestReset();

    const message = t.emails.sent.at(-1)!;
    expect(message.subject).toBe(`Reset your ${brand.name} password`);
    expect(message.text).toContain(`http://localhost:3000/reset-password#token=${token}`);
    expect(message.text).not.toMatch(/\?token=|\/reset-password\/[\w-]{20,}/);
    expect(message.text).toContain("expires in 1 hour.");
    expect(message.text).toMatch(/did not request/i);
  });

  it("answers identically for existing, unknown, unverified, disabled and Google-only addresses", async () => {
    await verifiedUser();
    await t.request("/auth/signup", { method: "POST", body: { email: "pending@example.com", password: PASSWORD } });
    await verifiedUser("disabled@example.com");
    await t.prisma.emailAccount.update({
      where: { email: "disabled@example.com" },
      data: { user: { update: { status: "DISABLED" } } },
    });

    const responses = [] as { status: number; body: unknown }[];
    for (const email of [EMAIL, "nobody@example.com", "pending@example.com", "disabled@example.com"]) {
      const response = await forgot(email);
      responses.push({ status: response.status, body: await response.json() });
    }
    for (const response of responses) expect(response).toEqual(responses[0]);
    expect(responses[0]).toEqual({ status: 202, body: { status: "reset_pending" } });
  });

  it("only sends mail to verified, active password accounts", async () => {
    await verifiedUser();
    await t.request("/auth/signup", { method: "POST", body: { email: "pending@example.com", password: PASSWORD } });
    await verifiedUser("disabled@example.com");
    await t.prisma.emailAccount.update({
      where: { email: "disabled@example.com" },
      data: { user: { update: { status: "DISABLED" } } },
    });
    t.emails.sent.length = 0;

    for (const email of ["nobody@example.com", "pending@example.com", "disabled@example.com"]) await forgot(email);
    await requestReset(EMAIL); // the eligible request is processed last, so the others have finished

    expect(t.emails.sent.map((message) => message.to)).toEqual([EMAIL]);
    expect(await t.prisma.passwordResetToken.count()).toBe(1);
  });

  it("generates random single-use tokens and stores only their hash, valid for one hour", async () => {
    await verifiedUser();
    const first = await requestReset();
    const second = await requestReset();

    expect(first).toMatch(/^[\w-]{43}$/);
    expect(second).not.toBe(first);

    const rows = await t.prisma.passwordResetToken.findMany({ select: { tokenHash: true, expiresAt: true, usedAt: true } });
    expect(rows.map((row) => row.tokenHash).sort()).toEqual([hashToken(first), hashToken(second)].sort());
    expect(JSON.stringify(rows)).not.toContain(first);
    expect(JSON.stringify(rows)).not.toContain(second);
    for (const row of rows) {
      expect(row.usedAt).toBeNull();
      expect(Math.abs(row.expiresAt.getTime() - (Date.now() + 3_600_000))).toBeLessThan(60_000);
    }
  });

  it("records a request event without secrets", async () => {
    await verifiedUser();
    const token = await requestReset();
    const events = await t.prisma.authEvent.findMany({ where: { type: "PASSWORD_RESET_REQUESTED" } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it("limits requests per IP", async () => {
    for (let i = 0; i < 5; i++) expect((await forgot(`user${i}@example.com`)).status).toBe(202);
    const limited = await forgot("one-more@example.com");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("silently caps reset emails per address", async () => {
    await verifiedUser();
    for (let i = 0; i < 3; i++) await requestReset();
    t.emails.sent.length = 0;
    expect((await forgot()).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(t.emails.sent).toHaveLength(0);
  });

  it("fails closed when Redis is unavailable", async () => {
    vi.spyOn(t.redis.client, "multi").mockImplementation(() => {
      throw new Error("redis down");
    });
    const response = await forgot();
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("reset password", () => {
  it("sets the new password, marks the token used and does not sign the user in", async () => {
    await verifiedUser();
    const before = await t.prisma.emailAccount.findUniqueOrThrow({ where: { email: EMAIL }, select: { passwordHash: true } });
    const token = await requestReset();

    const response = await reset(token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "password_reset" });
    expect(sessionCookie(response)).not.toMatch(/session=[\w-]{20,}/);

    const after = await t.prisma.emailAccount.findUniqueOrThrow({ where: { email: EMAIL }, select: { passwordHash: true } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect((await login(EMAIL, PASSWORD)).status).toBe(401);
    expect((await login(EMAIL, NEW_PASSWORD)).status).toBe(200);

    const stored = await t.prisma.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    expect(stored.usedAt).not.toBeNull();
  });

  it("revokes every existing session, so old cookies stop working", async () => {
    const first = await verifiedUser();
    const second = sessionCookie(await login())!;
    expect((await t.request("/auth/session", { cookie: first })).status).toBe(200);

    await reset(await requestReset());

    expect((await t.request("/auth/session", { cookie: first })).status).toBe(401);
    expect((await t.request("/auth/session", { cookie: second })).status).toBe(401);
    expect(await t.prisma.session.count({ where: { revokedAt: null } })).toBe(0);
  });

  it("rejects a reused token", async () => {
    await verifiedUser();
    const token = await requestReset();
    expect((await reset(token)).status).toBe(200);

    const again = await reset(token, "another-fresh-passphrase-9");
    expect(again.status).toBe(400);
    expect(await errorCode(again)).toBe("PASSWORD_RESET_INVALID");
    expect((await login(EMAIL, NEW_PASSWORD)).status).toBe(200);
  });

  it("rejects expired and unknown tokens with the same generic error", async () => {
    await verifiedUser();
    const token = await requestReset();
    await t.prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const expired = await reset(token);
    const unknown = await reset("A".repeat(43));
    expect([expired.status, unknown.status]).toEqual([400, 400]);
    expect(await errorCode(expired)).toBe("PASSWORD_RESET_INVALID");
    expect(await errorCode(unknown)).toBe("PASSWORD_RESET_INVALID");
    expect((await login(EMAIL, PASSWORD)).status).toBe(200);
  });

  it("rejects malformed tokens before touching the database", async () => {
    const response = await reset("not-a-token");
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_FAILED");
  });

  it("enforces the password policy without consuming the token", async () => {
    await verifiedUser();
    const token = await requestReset();

    for (const weak of ["short", "password123", "alex-the-great-2026"]) {
      const response = await reset(token, weak);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("VALIDATION_FAILED");
    }
    expect((await login(EMAIL, PASSWORD)).status).toBe(200);
    expect((await reset(token)).status).toBe(200);
  });

  it("lets only one of several simultaneous attempts succeed", async () => {
    await verifiedUser();
    const token = await requestReset();
    const passwords = Array.from({ length: 6 }, (_, i) => `simultaneous-attempt-pass-${i}`);

    const responses = await Promise.all(passwords.map((password) => reset(token, password)));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 400)).toHaveLength(5);

    const winner = passwords[responses.findIndex((response) => response.status === 200)]!;
    expect((await login(EMAIL, winner)).status).toBe(200);
    for (const password of passwords.filter((candidate) => candidate !== winner)) {
      expect((await login(EMAIL, password)).status).toBe(401);
    }
  });

  it("invalidates other outstanding reset links", async () => {
    await verifiedUser();
    const first = await requestReset();
    const second = await requestReset();

    expect((await reset(first)).status).toBe(200);
    expect((await reset(second, "yet-another-passphrase-31")).status).toBe(400);
  });

  it("does not let disabled users reset their password", async () => {
    await verifiedUser();
    const token = await requestReset();
    await t.prisma.user.updateMany({ data: { status: "DISABLED" } });

    const response = await reset(token);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("PASSWORD_RESET_INVALID");
    const account = await t.prisma.emailAccount.findUniqueOrThrow({ where: { email: EMAIL }, select: { passwordHash: true } });
    expect(account.passwordHash).toMatch(/^\$argon2id\$/);
    await t.prisma.user.updateMany({ data: { status: "ACTIVE" } });
    expect((await login(EMAIL, PASSWORD)).status).toBe(200);
  });

  it("records completed and failed events with no secrets", async () => {
    await verifiedUser();
    const token = await requestReset();
    await reset("B".repeat(43));
    await reset(token);

    const events = await t.prisma.authEvent.findMany({
      where: { type: { in: ["PASSWORD_RESET_COMPLETED", "PASSWORD_RESET_FAILED"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.type)).toEqual(["PASSWORD_RESET_FAILED", "PASSWORD_RESET_COMPLETED"]);
    expect(events[1]!.metadata).toEqual({ revokedSessions: 1 });
    const serialized = JSON.stringify(events);
    for (const secret of [token, hashToken(token), NEW_PASSWORD]) expect(serialized).not.toContain(secret);
  });

  it("limits submissions per IP", async () => {
    for (let i = 0; i < 10; i++) expect((await reset("C".repeat(43))).status).toBe(400);
    expect((await reset("C".repeat(43))).status).toBe(429);
  });

  it("fails closed when Redis is unavailable", async () => {
    await verifiedUser();
    const token = await requestReset();
    vi.spyOn(t.redis.client, "multi").mockImplementation(() => {
      throw new Error("redis down");
    });
    expect((await reset(token)).status).toBe(503);
    vi.restoreAllMocks();
    expect((await reset(token)).status).toBe(200); // the token was not consumed
  });

  it("rejects forged origins", async () => {
    const response = await t.request("/auth/reset-password", {
      method: "POST",
      body: { token: "D".repeat(43), password: NEW_PASSWORD },
      origin: "https://evil.example",
    });
    expect(response.status).toBe(403);
  });
});

describe("logging", () => {
  it("never writes reset tokens or passwords to the logs", async () => {
    const output: string[] = [];
    const capture = (chunk: string | Uint8Array) => {
      output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    };
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = capture as typeof process.stdout.write;
    process.stderr.write = capture as typeof process.stderr.write;

    let secrets: string[];
    try {
      await verifiedUser();
      const token = await requestReset();
      await reset(token, "short");
      await reset(token);
      await reset(token, "second-attempt-passphrase-8");
      const { passwordHash } = await t.prisma.emailAccount.findUniqueOrThrow({
        where: { email: EMAIL },
        select: { passwordHash: true },
      });
      secrets = [token, hashToken(token), NEW_PASSWORD, "second-attempt-passphrase-8", passwordHash];
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }

    const logs = output.join("");
    expect(logs).toContain("POST /api/v1/auth/reset-password"); // logging was captured
    for (const secret of secrets) expect(logs).not.toContain(secret);
  });
});
