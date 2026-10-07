import type { ApiErrorResponse, SessionResponse } from "@repo/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, sessionCookie, type TestApp } from "../test/test-app.ts";
import { hashToken } from "./tokens.ts";

const EMAIL = "alex@example.com";
const PASSWORD = "calm-river-sunrise-42";

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

const signup = (email = EMAIL, password = PASSWORD) =>
  t.request("/auth/signup", { method: "POST", body: { email, password } });
const login = (email = EMAIL, password = PASSWORD) =>
  t.request("/auth/login", { method: "POST", body: { email, password } });
const verify = (token: string) => t.request("/auth/verify-email", { method: "POST", body: { token } });
const errorCode = async (response: Response) => ((await response.json()) as ApiErrorResponse).code;

/** Signs up and verifies; returns the session cookie set by verification. */
async function verifiedUser(email = EMAIL): Promise<string> {
  await signup(email);
  const response = await verify(t.verificationToken(email));
  return sessionCookie(response)!;
}

describe("signup", () => {
  it("creates an unverified user with a public user number and sends a verification email, without a session", async () => {
    const response = await signup("  Alex@Example.COM ");

    expect(response.status).toBe(202);
    expect(sessionCookie(response)).toBeUndefined();
    const account = await t.prisma.emailAccount.findUniqueOrThrow({
      where: { email: EMAIL },
      select: { emailVerifiedAt: true, passwordHash: true, user: { select: { userNumber: true, status: true } } },
    });
    expect(account.emailVerifiedAt).toBeNull();
    expect(account.user.status).toBe("ACTIVE");
    expect(account.user.userNumber).toBeGreaterThanOrEqual(10000);
    expect(account.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(account.passwordHash).not.toContain(PASSWORD);
    expect(t.emails.sent).toHaveLength(1);
    expect(t.emails.sent[0]!.text).toContain("http://localhost:3000/verify-email#token=");

    const events = await t.prisma.authEvent.findMany({ select: { type: true }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.type)).toEqual(["SIGNUP_STARTED", "USER_CREATED", "EMAIL_VERIFICATION_SENT"]);
  });

  it("stores only a hash of the verification token", async () => {
    await signup();
    const token = t.verificationToken(EMAIL);
    const stored = await t.prisma.emailVerificationToken.findFirstOrThrow({ select: { tokenHash: true } });
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(stored.tokenHash).not.toContain(token);
  });

  it("keeps signup generic and removes the unsent verification token when delivery fails", async () => {
    t.emails.failNext(new Error("SMTP authentication rejected"));

    const failed = await signup();
    expect(failed.status).toBe(202);
    expect(await failed.json()).toEqual({ status: "verification_pending" });
    expect(await t.prisma.emailAccount.count()).toBe(1);
    expect(await t.prisma.emailVerificationToken.count()).toBe(0);

    const retry = await signup();
    expect(retry.status).toBe(202);
    expect(await t.prisma.emailVerificationToken.count()).toBe(1);
  });

  it("keeps resend generic and removes its unsent token when delivery fails", async () => {
    await signup();
    t.emails.failNext(new Error("SMTP authentication rejected"));
    const response = await t.request("/auth/verification/resend", {
      method: "POST",
      body: { email: EMAIL },
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "verification_pending" });
    expect(await t.prisma.emailVerificationToken.count()).toBe(1);

    const retry = await t.request("/auth/verification/resend", {
      method: "POST",
      body: { email: EMAIL },
    });
    expect(retry.status).toBe(202);
    expect(await t.prisma.emailVerificationToken.count()).toBe(2);
  });

  it("prevents duplicate accounts without revealing that the email is registered", async () => {
    const first = await signup();
    await verify(t.verificationToken(EMAIL));
    const second = await signup(EMAIL.toUpperCase(), "another-long-passphrase");

    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual({ status: "verification_pending" });
    expect(await t.prisma.emailAccount.count()).toBe(1);
    expect(await t.prisma.user.count()).toBe(1);
    expect(t.emails.sent.at(-1)!.subject).toContain("already have");
  });

  it("rejects weak passwords with a validation error", async () => {
    const response = await signup(EMAIL, "password123");
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_FAILED");
    expect(await t.prisma.user.count()).toBe(0);
  });

  it("rate-limits signups per IP", async () => {
    for (let i = 0; i < 10; i++) expect((await signup(`user${i}@example.com`)).status).toBe(202);
    const blocked = await signup("one-more@example.com");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
  });
});

describe("email verification", () => {
  it("verifies the email, signs the user in and makes the token single-use", async () => {
    await signup();
    const token = t.verificationToken(EMAIL);

    const response = await verify(token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as SessionResponse;
    expect(body.user).toMatchObject({ email: EMAIL, emailVerified: true });
    expect(sessionCookie(response)).toBeDefined();

    const reused = await verify(token);
    expect(reused.status).toBe(400);
    expect(await errorCode(reused)).toBe("VERIFICATION_LINK_INVALID");
  });

  it("rejects expired tokens", async () => {
    await signup();
    const token = t.verificationToken(EMAIL);
    await t.prisma.emailVerificationToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await verify(token);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VERIFICATION_LINK_INVALID");
    const account = await t.prisma.emailAccount.findUniqueOrThrow({ where: { email: EMAIL }, select: { emailVerifiedAt: true } });
    expect(account.emailVerifiedAt).toBeNull();
  });

  it("rejects unknown and malformed tokens", async () => {
    expect((await verify("x".repeat(43))).status).toBe(400);
    expect(await errorCode(await verify("not-a-token"))).toBe("VALIDATION_FAILED");
  });

  it("lets only one of two concurrent requests use a token", async () => {
    await signup();
    const token = t.verificationToken(EMAIL);
    const results = await Promise.all([verify(token), verify(token), verify(token)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 400, 400]);
  });

  it("resends for unverified accounts and responds identically for unknown emails", async () => {
    await signup();
    const resend = (email: string) => t.request("/auth/verification/resend", { method: "POST", body: { email } });

    const known = await resend(EMAIL);
    const unknown = await resend("nobody@example.com");
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await unknown.json()).toEqual(await known.json());
    expect(t.emails.sent.filter((email) => email.to === EMAIL)).toHaveLength(2);
    expect(t.emails.sent.filter((email) => email.to === "nobody@example.com")).toHaveLength(0);
  });

  it("caps verification emails per address silently", async () => {
    await signup();
    for (let i = 0; i < 5; i++) {
      const response = await t.request("/auth/verification/resend", { method: "POST", body: { email: EMAIL } });
      expect(response.status).toBe(202);
    }
    expect(t.emails.sent).toHaveLength(3);
  });
});

describe("login", () => {
  it("signs in with correct credentials and creates a server-side session", async () => {
    await verifiedUser();
    const response = await login(" ALEX@example.com ");

    expect(response.status).toBe(200);
    expect(((await response.json()) as SessionResponse).user.email).toBe(EMAIL);
    const setCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith("session="))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Expires=/);

    const token = sessionCookie(response)!.split("=")[1]!;
    const session = await t.prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
      select: { revokedAt: true, expiresAt: true, ipAddress: true },
    });
    expect(session.revokedAt).toBeNull();
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(session.ipAddress).toBeTruthy();
  });

  it("returns the same generic error for a wrong password and an unknown email", async () => {
    await verifiedUser();
    const wrongPassword = await login(EMAIL, "not-the-right-password");
    const unknownEmail = await login("nobody@example.com", PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const [a, b] = [(await wrongPassword.json()) as ApiErrorResponse, (await unknownEmail.json()) as ApiErrorResponse];
    expect(a.code).toBe("INVALID_CREDENTIALS");
    expect([b.code, b.message]).toEqual([a.code, a.message]);
    expect(sessionCookie(wrongPassword)).toBeUndefined();

    const failures = await t.prisma.authEvent.count({ where: { type: "LOGIN_FAILED" } });
    expect(failures).toBe(2);
  });

  it("does not sign in unverified accounts and resends the link", async () => {
    await signup();
    t.emails.sent.length = 0;

    const response = await login();
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("EMAIL_NOT_VERIFIED");
    expect(sessionCookie(response)).toBeUndefined();
    expect(t.emails.sent).toHaveLength(1);
  });

  it("does not sign in disabled accounts", async () => {
    await verifiedUser();
    await t.prisma.user.updateMany({ data: { status: "DISABLED" } });
    expect(await errorCode(await login())).toBe("INVALID_CREDENTIALS");
  });

  it("locks an email after repeated failures, even with the right password", async () => {
    await verifiedUser();
    for (let i = 0; i < 10; i++) expect((await login(EMAIL, `wrong-password-${i}`)).status).toBe(401);
    expect((await login()).status).toBe(429);
  });
});

describe("sessions and logout", () => {
  it("authenticates requests with the session cookie", async () => {
    const cookie = await verifiedUser();
    const response = await t.request("/auth/session", { cookie });
    expect(response.status).toBe(200);
    expect(((await response.json()) as SessionResponse).user).toMatchObject({ email: EMAIL, emailVerified: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects requests without a session, or with an unknown one", async () => {
    expect((await t.request("/auth/session")).status).toBe(401);
    const unknown = await t.request("/auth/session", { cookie: `session=${"a".repeat(43)}` });
    expect(unknown.status).toBe(401);
    expect(await errorCode(unknown)).toBe("UNAUTHENTICATED");
  });

  it("logout revokes the session server-side, so the old cookie stops working", async () => {
    const cookie = await verifiedUser();
    const response = await t.request("/auth/logout", { method: "POST", cookie });

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie().join()).toMatch(/session=;.*Expires=Thu, 01 Jan 1970/);
    const session = await t.prisma.session.findFirstOrThrow({ select: { revokedAt: true } });
    expect(session.revokedAt).not.toBeNull();
    // Replaying the old cookie (e.g. copied before logout) is rejected.
    expect((await t.request("/auth/session", { cookie })).status).toBe(401);
    expect(await t.prisma.authEvent.count({ where: { type: "LOGOUT" } })).toBe(1);
  });

  it("rejects expired and idle sessions", async () => {
    const cookie = await verifiedUser();
    await t.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await t.request("/auth/session", { cookie })).status).toBe(401);

    const second = sessionCookie(await login())!;
    await t.prisma.session.updateMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      data: { lastActiveAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) },
    });
    expect((await t.request("/auth/session", { cookie: second })).status).toBe(401);
  });

  it("rejects sessions of disabled users", async () => {
    const cookie = await verifiedUser();
    await t.prisma.user.updateMany({ data: { status: "DISABLED" } });
    expect((await t.request("/auth/session", { cookie })).status).toBe(401);
  });
});

describe("CSRF protection", () => {
  it("rejects state-changing requests from other origins or without an origin", async () => {
    const cookie = await verifiedUser();
    const foreign = await t.request("/auth/logout", { method: "POST", cookie, origin: "https://evil.example" });
    const missing = await t.request("/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD }, origin: null });

    expect(foreign.status).toBe(403);
    expect(await errorCode(foreign)).toBe("FORBIDDEN_ORIGIN");
    expect(missing.status).toBe(403);
    // The session survived the forged logout.
    expect((await t.request("/auth/session", { cookie })).status).toBe(200);
  });
});

describe("client IP", () => {
  it("ignores a client-supplied X-Forwarded-For unless a trusted proxy is configured", async () => {
    await t.request("/auth/login", {
      method: "POST",
      body: { email: EMAIL, password: PASSWORD },
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    const event = await t.prisma.authEvent.findFirstOrThrow({ where: { type: "LOGIN_FAILED" }, select: { ipAddress: true } });
    expect(event.ipAddress).not.toBe("203.0.113.9");
    expect(event.ipAddress).toMatch(/127\.0\.0\.1/);
  });
});

describe("logging", () => {
  it("never writes passwords, hashes, tokens or session cookies to the logs", async () => {
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
      await signup();
      const token = t.verificationToken(EMAIL);
      const cookie = sessionCookie(await verify(token))!;
      await verify(token); // reuse attempt
      await login(EMAIL, "wrong-password-attempt");
      const loginCookie = sessionCookie(await login())!;
      await t.request("/auth/session", { cookie: loginCookie });
      await t.request("/auth/logout", { method: "POST", cookie: loginCookie });

      const { passwordHash } = await t.prisma.emailAccount.findUniqueOrThrow({
        where: { email: EMAIL },
        select: { passwordHash: true },
      });
      secrets = [PASSWORD, "wrong-password-attempt", passwordHash, token, hashToken(token), cookie.split("=")[1]!, loginCookie.split("=")[1]!];
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }

    const logs = output.join("");
    expect(logs).toContain("POST /api/v1/auth/login"); // logging was captured
    for (const secret of secrets) expect(logs).not.toContain(secret);
  });
});
