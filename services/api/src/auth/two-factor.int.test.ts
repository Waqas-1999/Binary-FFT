import { brand } from "@repo/config";
import type { ApiErrorResponse, RecoveryCodesResponse, SecurityStatus, SessionResponse, TwoFactorSetup } from "@repo/types";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, responseCookie, sessionCookie, type TestApp } from "../test/test-app.ts";
import { hashToken } from "./tokens.ts";
import { hashRecoveryCode } from "./two-factor/recovery-codes.ts";
import { totpCode, totpStep } from "./two-factor/totp.ts";

const EMAIL = "alex@example.com";
const PASSWORD = "calm-river-sunrise-42";
const GINA = { subject: "google-subject-gina", email: "gina@gmail.test" };

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

const post = (path: string, body?: unknown, cookie?: string, extra: Record<string, string> = {}) =>
  t.request(path, { method: "POST", body: body ?? {}, cookie, headers: extra });
const get = (path: string, cookie?: string, headers?: Record<string, string>) => t.request(path, { cookie, headers });
const login = (email = EMAIL, password = PASSWORD, headers?: Record<string, string>) =>
  t.request("/auth/login", { method: "POST", body: { email, password }, headers });
const errorCode = async (response: Response) => ((await response.json()) as ApiErrorResponse).code;
const cookieValue = (pair: string) => pair.split("=")[1]!;

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FIREFOX_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0";

/** Creates a verified password account; returns its first session cookie. */
async function verifiedUser(email = EMAIL, headers?: Record<string, string>): Promise<string> {
  await post("/auth/signup", { email, password: PASSWORD }, undefined, headers);
  return sessionCookie(await post("/auth/verify-email", { token: t.verificationToken(email) }, undefined, headers))!;
}

/** A code for the current time step. Clears the "already used" marker first, so tests control replay explicitly. */
async function freshCode(secret: string): Promise<string> {
  await t.prisma.userTwoFactor.updateMany({ data: { lastUsedStep: null } });
  return totpCode(secret, totpStep(Date.now()));
}

async function enableTwoFactor(cookie: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = (await (await post("/auth/2fa/setup", undefined, cookie)).json()) as TwoFactorSetup;
  const confirmed = await post("/auth/2fa/confirm", { code: totpCode(setup.secret, totpStep(Date.now())) }, cookie);
  expect(confirmed.status).toBe(200);
  const { recoveryCodes } = (await confirmed.json()) as RecoveryCodesResponse;
  return { secret: setup.secret, recoveryCodes };
}

/** Password sign-in for a two-factor account; returns the challenge cookie. */
async function startChallenge(email = EMAIL, headers?: Record<string, string>): Promise<string> {
  const response = await login(email, PASSWORD, headers);
  expect(await response.json()).toEqual({ status: "two_factor_required" });
  return responseCookie(response, "login-challenge")!;
}

/** Moves a session's last strong authentication into the past. */
async function ageAuthentication(cookie: string, minutes: number): Promise<void> {
  await t.prisma.session.update({
    where: { tokenHash: hashToken(cookieValue(cookie)) },
    data: { authenticatedAt: new Date(Date.now() - minutes * 60_000) },
  });
}

async function googleSignIn(identity = GINA): Promise<Response> {
  const start = await t.request("/auth/google", { redirect: "manual" });
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const code = t.google.approve(state, identity);
  return t.request(`/auth/google/callback?${new URLSearchParams({ state, code })}`, {
    cookie: responseCookie(start, "oauth-binding"),
    redirect: "manual",
  });
}

/** The security email sent after the response, so wait for it. */
async function securityEmail(subjectPart: string) {
  await vi.waitFor(() => expect(t.emails.sent.some((message) => message.subject.includes(subjectPart))).toBe(true));
  return t.emails.sent.findLast((message) => message.subject.includes(subjectPart))!;
}

describe("two-factor setup", () => {
  it("requires an authenticated session", async () => {
    for (const path of ["/auth/2fa/setup", "/auth/2fa/confirm", "/auth/2fa/disable", "/auth/2fa/recovery-codes"]) {
      expect((await post(path, { code: "123456" })).status).toBe(401);
    }
  });

  it("starts without enabling anything, and returns only what the app needs to scan or type", async () => {
    const cookie = await verifiedUser();
    const response = await post("/auth/2fa/setup", undefined, cookie);
    const setup = (await response.json()) as TwoFactorSetup;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(setup).sort()).toEqual(["expiresInSeconds", "otpauthUri", "secret"]);
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);

    const uri = new URL(setup.otpauthUri);
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.searchParams.get("issuer")).toBe(brand.name);
    expect(uri.searchParams.get("secret")).toBe(setup.secret);
    expect(decodeURIComponent(uri.pathname)).toBe(`/${brand.name}:${EMAIL}`);

    expect(await t.prisma.userTwoFactor.count()).toBe(0);
    expect(await t.prisma.recoveryCode.count()).toBe(0);
    const [key] = await t.redis.client.keys("2fa:setup:*");
    expect(await t.redis.client.get(key!)).not.toContain(setup.secret); // pending secret is encrypted too
    expect(await t.redis.client.ttl(key!)).toBeLessThanOrEqual(600);
    expect(((await (await get("/auth/security", cookie)).json()) as SecurityStatus).twoFactor.enabled).toBe(false);
    expect((await login()).status).toBe(200); // still an ordinary sign-in
    expect((await t.prisma.authEvent.findMany({ where: { type: "TWO_FACTOR_SETUP_STARTED" } })).length).toBe(1);
  });

  it("enables on a valid code: encrypted secret, ten hashed recovery codes, event and email", async () => {
    const cookie = await verifiedUser();
    const { secret, recoveryCodes } = await enableTwoFactor(cookie);

    const stored = await t.prisma.userTwoFactor.findFirstOrThrow();
    expect(stored.method).toBe("TOTP");
    expect(stored.encryptedSecret).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(stored.encryptedSecret).not.toContain(secret);
    expect(stored.lastUsedStep).not.toBeNull();

    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    const rows = await t.prisma.recoveryCode.findMany();
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((row) => row.generation)).size).toBe(1);
    expect(rows.every((row) => row.usedAt === null)).toBe(true);
    expect(rows.map((row) => row.codeHash).sort()).toEqual(recoveryCodes.map((code) => hashRecoveryCode(code.replaceAll("-", ""))).sort());
    expect(JSON.stringify(rows)).not.toContain(recoveryCodes[0]!.replaceAll("-", ""));

    const types = (await t.prisma.authEvent.findMany({ orderBy: { createdAt: "asc" } })).map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining(["TWO_FACTOR_SETUP_STARTED", "TWO_FACTOR_ENABLED", "RECOVERY_CODES_GENERATED"]));

    const email = await securityEmail("Two-factor authentication is on");
    expect(email.to).toBe(EMAIL);
    expect(email.text).toContain(brand.name);
    expect(email.text).toMatch(/If this wasn't you/);
    expect(email.text).not.toContain(secret);

    const status = (await (await get("/auth/security", cookie)).json()) as SecurityStatus;
    expect(status.twoFactor).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });
    expect(JSON.stringify(status)).not.toContain(secret);
  });

  it("rejects wrong codes and a missing setup with the same answer, enabling nothing", async () => {
    const cookie = await verifiedUser();
    const noSetup = await post("/auth/2fa/confirm", { code: "123456" }, cookie);
    const setup = (await (await post("/auth/2fa/setup", undefined, cookie)).json()) as TwoFactorSetup;
    const wrongCode = totpCode(setup.secret, totpStep(Date.now()) + 10);
    const wrong = await post("/auth/2fa/confirm", { code: wrongCode }, cookie);

    for (const response of [noSetup, wrong]) {
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("TWO_FACTOR_CODE_INVALID");
    }
    expect((await post("/auth/2fa/confirm", { code: "12345" }, cookie)).status).toBe(400); // malformed
    expect(await t.prisma.userTwoFactor.count()).toBe(0);
    expect((await t.prisma.authEvent.findMany({ where: { type: "TWO_FACTOR_FAILED" } })).length).toBe(2);
  });

  it("does not enable from an expired setup", async () => {
    const cookie = await verifiedUser();
    const setup = (await (await post("/auth/2fa/setup", undefined, cookie)).json()) as TwoFactorSetup;
    const [key] = await t.redis.client.keys("2fa:setup:*");
    await t.redis.client.pexpire(key!, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const response = await post("/auth/2fa/confirm", { code: totpCode(setup.secret, totpStep(Date.now())) }, cookie);
    expect(response.status).toBe(400);
    expect(await t.prisma.userTwoFactor.count()).toBe(0);
  });

  it("cannot be replayed, and only one of several simultaneous confirmations wins", async () => {
    const cookie = await verifiedUser();
    const setup = (await (await post("/auth/2fa/setup", undefined, cookie)).json()) as TwoFactorSetup;
    const code = totpCode(setup.secret, totpStep(Date.now()));

    const results = await Promise.all(Array.from({ length: 5 }, () => post("/auth/2fa/confirm", { code }, cookie)));
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
    expect(await t.prisma.userTwoFactor.count()).toBe(1);
    expect(await t.prisma.recoveryCode.count()).toBe(10);

    expect((await post("/auth/2fa/confirm", { code }, cookie)).status).toBe(400);
  });

  it("is tied to the session that started it: another user or another session cannot confirm", async () => {
    const alex = await verifiedUser();
    const bob = await verifiedUser("bob@example.com");
    const alexSecondSession = sessionCookie(await login())!;
    const setup = (await (await post("/auth/2fa/setup", undefined, alex)).json()) as TwoFactorSetup;
    const code = totpCode(setup.secret, totpStep(Date.now()));

    expect((await post("/auth/2fa/confirm", { code }, bob)).status).toBe(400);
    expect((await post("/auth/2fa/confirm", { code }, alexSecondSession)).status).toBe(400);
    expect(await t.prisma.userTwoFactor.count()).toBe(0);
    expect((await post("/auth/2fa/confirm", { code }, alex)).status).toBe(200); // the right session still can
  });

  it("refuses to start again once enabled", async () => {
    const cookie = await verifiedUser();
    await enableTwoFactor(cookie);
    const response = await post("/auth/2fa/setup", undefined, cookie);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("TWO_FACTOR_ALREADY_ENABLED");
  });

  it("allows only one configuration per user in the database itself", async () => {
    const cookie = await verifiedUser();
    await enableTwoFactor(cookie);
    const { userId } = await t.prisma.userTwoFactor.findFirstOrThrow();
    await expect(
      t.prisma.userTwoFactor.create({ data: { userId, method: "TOTP", encryptedSecret: "v1.a.b.c" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("limits confirmation attempts", async () => {
    const cookie = await verifiedUser();
    await post("/auth/2fa/setup", undefined, cookie);
    for (let i = 0; i < 10; i++) expect((await post("/auth/2fa/confirm", { code: "000000" }, cookie)).status).toBe(400);
    const limited = await post("/auth/2fa/confirm", { code: "000000" }, cookie);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("fails closed when Redis is unavailable", async () => {
    const cookie = await verifiedUser();
    vi.spyOn(t.redis.client, "multi").mockImplementation(() => {
      throw new Error("redis down");
    });
    expect((await post("/auth/2fa/setup", undefined, cookie)).status).toBe(503);
    expect((await post("/auth/2fa/confirm", { code: "123456" }, cookie)).status).toBe(503);
  });
});

describe("two-factor sign-in", () => {
  it("leaves accounts without two-factor alone", async () => {
    await verifiedUser();
    const response = await login();
    expect(response.status).toBe(200);
    expect(((await response.json()) as SessionResponse).user.email).toBe(EMAIL);
    expect(sessionCookie(response)).toBeTruthy();
    expect(responseCookie(response, "login-challenge")).toBeUndefined();
  });

  it("asks for the second factor after the password and creates no session until it is given", async () => {
    const cookie = await verifiedUser();
    await enableTwoFactor(cookie);
    const sessionsBefore = await t.prisma.session.count();

    const response = await login();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "two_factor_required" });
    expect(sessionCookie(response)).toBeUndefined();
    expect(await t.prisma.session.count()).toBe(sessionsBefore);

    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith("login-challenge="))!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const token = cookieValue(setCookie.split(";")[0]!);
    const challenge = await t.prisma.authChallenge.findFirstOrThrow();
    expect(challenge.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(challenge)).not.toContain(token);
    expect(challenge.purpose).toBe("LOGIN_2FA");
    expect(Math.abs(challenge.expiresAt.getTime() - (Date.now() + 300_000))).toBeLessThan(10_000);

    expect((await get("/auth/session")).status).toBe(401);
    const types = (await t.prisma.authEvent.findMany({ where: { userId: challenge.userId } })).map((event) => event.type);
    expect(types).toContain("NEW_LOGIN_2FA_REQUIRED");
    expect(await t.prisma.authEvent.count({ where: { type: "LOGIN_SUCCESS", metadata: { path: ["twoFactor"], equals: true } } })).toBe(0);
  });

  it("completes with a valid authenticator code and consumes the challenge", async () => {
    const { secret } = await enableTwoFactor(await verifiedUser());
    const challenge = await startChallenge();
    const response = await post("/auth/2fa/verify", { code: await freshCode(secret) }, challenge);

    expect(response.status).toBe(200);
    expect(((await response.json()) as SessionResponse).user).toMatchObject({ email: EMAIL, googleConnected: false });
    const cookie = sessionCookie(response)!;
    expect(cookie).toBeTruthy();
    expect(response.headers.getSetCookie().find((value) => value.startsWith("login-challenge="))).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await get("/auth/session", cookie)).status).toBe(200);

    expect((await t.prisma.authChallenge.findFirstOrThrow()).consumedAt).not.toBeNull();
    const success = await t.prisma.authEvent.findFirstOrThrow({ where: { type: "LOGIN_SUCCESS" }, orderBy: { createdAt: "desc" } });
    expect(success.metadata).toMatchObject({ method: "password", twoFactor: true });
  });

  it("rejects wrong codes without creating a session, then gives up on the challenge", async () => {
    const { secret } = await enableTwoFactor(await verifiedUser());
    const challenge = await startChallenge();
    const sessions = await t.prisma.session.count();

    for (let i = 0; i < 5; i++) {
      const response = await post("/auth/2fa/verify", { code: "000000" }, challenge);
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("TWO_FACTOR_CODE_INVALID");
      expect(sessionCookie(response)).toBeUndefined();
    }
    // Even the right code no longer works: the person has to sign in again.
    const dead = await post("/auth/2fa/verify", { code: await freshCode(secret) }, challenge);
    expect(dead.status).toBe(401);
    expect(await errorCode(dead)).toBe("TWO_FACTOR_CHALLENGE_INVALID");
    expect(await t.prisma.session.count()).toBe(sessions);
    expect((await t.prisma.authEvent.findMany({ where: { type: "TWO_FACTOR_FAILED" } })).length).toBe(5);
  });

  it("rejects expired, missing, forged and replayed challenges", async () => {
    const { secret } = await enableTwoFactor(await verifiedUser());

    const expired = await startChallenge();
    await t.prisma.authChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await post("/auth/2fa/verify", { code: await freshCode(secret) }, expired);
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("TWO_FACTOR_CHALLENGE_INVALID");

    for (const cookie of [undefined, "login-challenge=", `login-challenge=${"x".repeat(43)}`]) {
      expect(await errorCode(await post("/auth/2fa/verify", { code: await freshCode(secret) }, cookie))).toBe("TWO_FACTOR_CHALLENGE_INVALID");
    }

    const replayed = await startChallenge();
    expect((await post("/auth/2fa/verify", { code: await freshCode(secret) }, replayed)).status).toBe(200);
    expect(await errorCode(await post("/auth/2fa/verify", { code: await freshCode(secret) }, replayed))).toBe("TWO_FACTOR_CHALLENGE_INVALID");
  });

  it("does not accept a challenge sent in the request body", async () => {
    const { secret } = await enableTwoFactor(await verifiedUser());
    const challenge = await startChallenge();
    const response = await post("/auth/2fa/verify", { code: await freshCode(secret), challenge: cookieValue(challenge) });
    expect(await errorCode(response)).toBe("TWO_FACTOR_CHALLENGE_INVALID");
  });

  it("will not accept a code that was already used, even in a new challenge", async () => {
    const { secret } = await enableTwoFactor(await verifiedUser());
    const code = await freshCode(secret);
    expect((await post("/auth/2fa/verify", { code }, await startChallenge())).status).toBe(200);
    const again = await post("/auth/2fa/verify", { code }, await startChallenge());
    expect(again.status).toBe(401);
    expect(await errorCode(again)).toBe("TWO_FACTOR_CODE_INVALID");
  });

  it("checks the code against the challenge's own user, never another user's", async () => {
    const alexSecret = (await enableTwoFactor(await verifiedUser())).secret;
    const bobSecret = (await enableTwoFactor(await verifiedUser("bob@example.com"))).secret;
    const alexChallenge = await startChallenge();

    const bobsCode = await freshCode(bobSecret);
    const response = await post("/auth/2fa/verify", { code: bobsCode }, alexChallenge);
    expect(response.status).toBe(401);
    expect(sessionCookie(response)).toBeUndefined();
    expect((await post("/auth/2fa/verify", { code: await freshCode(alexSecret) }, alexChallenge)).status).toBe(200);
  });

  it("lets only one of several simultaneous attempts complete a challenge", async () => {
    const { secret } = await enableTwoFactor(await verifiedUser());
    const challenge = await startChallenge();
    const code = await freshCode(secret);
    const results = await Promise.all(Array.from({ length: 6 }, () => post("/auth/2fa/verify", { code }, challenge)));
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
    expect(await t.prisma.session.count({ where: { revokedAt: null } })).toBe(2); // enabling session + this one
  });

  it("does not let a disabled user finish signing in", async () => {
    const { secret } = await enableTwoFactor(await verifiedUser());
    const challenge = await startChallenge();
    await t.prisma.user.updateMany({ data: { status: "DISABLED" } });
    const response = await post("/auth/2fa/verify", { code: await freshCode(secret) }, challenge);
    expect(response.status).toBe(401);
    expect(sessionCookie(response)).toBeUndefined();
  });

  it("limits code guessing per account, across challenges", async () => {
    await enableTwoFactor(await verifiedUser());
    const statuses: number[] = [];
    for (let round = 0; round < 3; round++) {
      const challenge = await startChallenge();
      for (let i = 0; i < 5; i++) statuses.push((await post("/auth/2fa/verify", { code: "000000" }, challenge)).status);
    }
    expect(statuses).toContain(429);
    expect(statuses).not.toContain(200);
  });

  it("fails closed when Redis is unavailable", async () => {
    const { secret } = await enableTwoFactor(await verifiedUser());
    const challenge = await startChallenge();
    const code = await freshCode(secret);
    vi.spyOn(t.redis.client, "multi").mockImplementation(() => {
      throw new Error("redis down");
    });
    const response = await post("/auth/2fa/verify", { code }, challenge);
    expect(response.status).toBe(503);
    expect(sessionCookie(response)).toBeUndefined();
    vi.restoreAllMocks();
    expect((await post("/auth/2fa/verify", { code }, challenge)).status).toBe(200); // nothing was consumed
  });

  it("applies to Google sign-in too, and only issues a session after the second factor", async () => {
    const first = await googleSignIn();
    const cookie = sessionCookie(first)!;
    const { secret } = await enableTwoFactor(cookie);
    const sessionsBefore = await t.prisma.session.count();

    const second = await googleSignIn();
    expect(second.status).toBe(302);
    expect(new URL(second.headers.get("location")!).pathname + new URL(second.headers.get("location")!).search).toBe("/login?step=two-factor&next=%2Ftrade");
    expect(sessionCookie(second)).toBeUndefined();
    expect(await t.prisma.session.count()).toBe(sessionsBefore);
    const challenge = responseCookie(second, "login-challenge")!;
    expect(challenge).toBeTruthy();

    const done = await post("/auth/2fa/verify", { code: await freshCode(secret) }, challenge);
    expect(done.status).toBe(200);
    expect((await get("/auth/session", sessionCookie(done))).status).toBe(200);
    const event = await t.prisma.authEvent.findFirstOrThrow({ where: { type: "GOOGLE_LOGIN_SUCCESS" }, orderBy: { createdAt: "desc" } });
    expect(event.metadata).toMatchObject({ method: "google", twoFactor: true });
  });

  it("does not let a disabled Google user past the challenge either", async () => {
    const { secret } = await enableTwoFactor(sessionCookie(await googleSignIn())!);
    const challenge = responseCookie(await googleSignIn(), "login-challenge")!;
    await t.prisma.user.updateMany({ data: { status: "DISABLED" } });
    expect((await post("/auth/2fa/verify", { code: await freshCode(secret) }, challenge)).status).toBe(401);
  });
});

describe("recovery codes", () => {
  it("completes a sign-in once, in any common formatting, and never again", async () => {
    const { recoveryCodes } = await enableTwoFactor(await verifiedUser());
    const [first, second] = recoveryCodes as [string, string];

    const response = await post("/auth/2fa/recovery", { code: first.toLowerCase().replaceAll("-", " ") }, await startChallenge());
    expect(response.status).toBe(200);
    expect(sessionCookie(response)).toBeTruthy();

    const reused = await post("/auth/2fa/recovery", { code: first }, await startChallenge());
    expect(reused.status).toBe(401);
    expect(await errorCode(reused)).toBe("TWO_FACTOR_CODE_INVALID");
    expect(sessionCookie(reused)).toBeUndefined();
    expect((await post("/auth/2fa/recovery", { code: second }, await startChallenge())).status).toBe(200);

    const used = await t.prisma.recoveryCode.count({ where: { usedAt: { not: null } } });
    expect(used).toBe(2);
    expect(await t.prisma.authEvent.count({ where: { type: "RECOVERY_CODE_USED" } })).toBe(2);
  });

  it("lets only one of several simultaneous uses of a code succeed", async () => {
    const { recoveryCodes } = await enableTwoFactor(await verifiedUser());
    const challenges = await Promise.all(Array.from({ length: 5 }, () => startChallenge()));
    const results = await Promise.all(challenges.map((challenge) => post("/auth/2fa/recovery", { code: recoveryCodes[0]! }, challenge)));
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
    expect(await t.prisma.recoveryCode.count({ where: { usedAt: { not: null } } })).toBe(1);
  });

  it("does not burn a code when its challenge is already gone", async () => {
    const { recoveryCodes } = await enableTwoFactor(await verifiedUser());
    const response = await post("/auth/2fa/recovery", { code: recoveryCodes[0]! }, `login-challenge=${"y".repeat(43)}`);
    expect(response.status).toBe(401);
    expect(await t.prisma.recoveryCode.count({ where: { usedAt: { not: null } } })).toBe(0);
  });

  it("rejects another user's codes and malformed codes", async () => {
    await enableTwoFactor(await verifiedUser());
    const bob = await enableTwoFactor(await verifiedUser("bob@example.com"));
    const response = await post("/auth/2fa/recovery", { code: bob.recoveryCodes[0]! }, await startChallenge());
    expect(response.status).toBe(401);
    expect((await post("/auth/2fa/recovery", { code: "nope" }, await startChallenge())).status).toBe(400);
    expect(await t.prisma.recoveryCode.count({ where: { usedAt: { not: null } } })).toBe(0);
  });

  it("is never returned again after setup", async () => {
    const cookie = await verifiedUser();
    const { recoveryCodes } = await enableTwoFactor(cookie);
    const responses = [await get("/auth/security", cookie), await get("/auth/sessions", cookie), await get("/auth/session", cookie)];
    for (const response of responses) {
      const text = await response.text();
      for (const code of recoveryCodes) expect(text).not.toContain(code.replaceAll("-", ""));
    }
    expect((await get("/auth/2fa/recovery-codes", cookie)).status).toBe(404);
  });

  describe("regeneration", () => {
    it("needs a recent authentication and a current authenticator code", async () => {
      const cookie = await verifiedUser();
      const { secret } = await enableTwoFactor(cookie);

      await ageAuthentication(cookie, 30);
      const stale = await post("/auth/2fa/recovery-codes", { code: await freshCode(secret) }, cookie);
      expect(stale.status).toBe(403);
      expect(await errorCode(stale)).toBe("REAUTHENTICATION_REQUIRED");

      expect((await post("/auth/reauthenticate", { password: PASSWORD }, cookie)).status).toBe(204);
      const wrong = await post("/auth/2fa/recovery-codes", { code: "000000" }, cookie);
      expect(wrong.status).toBe(400);
      expect((await post("/auth/2fa/recovery-codes", {}, cookie)).status).toBe(400);
      expect(await t.prisma.recoveryCode.count()).toBe(10);
    });

    it("replaces the whole set: old codes die, new ones work, once", async () => {
      const cookie = await verifiedUser();
      const { secret, recoveryCodes: old } = await enableTwoFactor(cookie);
      const oldGeneration = (await t.prisma.recoveryCode.findFirstOrThrow()).generation;

      const response = await post("/auth/2fa/recovery-codes", { code: await freshCode(secret) }, cookie);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const { recoveryCodes } = (await response.json()) as RecoveryCodesResponse;

      expect(recoveryCodes).toHaveLength(10);
      expect(recoveryCodes.some((code) => old.includes(code))).toBe(false);
      const rows = await t.prisma.recoveryCode.findMany();
      expect(rows).toHaveLength(10);
      expect(rows[0]!.generation).not.toBe(oldGeneration);
      expect(await t.prisma.recoveryCode.count({ where: { codeHash: { in: old.map((code) => hashRecoveryCode(code.replaceAll("-", ""))) } } })).toBe(0);

      expect((await post("/auth/2fa/recovery", { code: old[0]! }, await startChallenge())).status).toBe(401);
      expect((await post("/auth/2fa/recovery", { code: recoveryCodes[0]! }, await startChallenge())).status).toBe(200);
      expect((await t.prisma.authEvent.findMany({ where: { type: "RECOVERY_CODES_REGENERATED" } })).length).toBe(1);
      const email = await securityEmail("New recovery codes");
      for (const code of [...old, ...recoveryCodes]) expect(email.text).not.toContain(code);
    });
  });
});

describe("disabling two-factor", () => {
  it("cannot be done with an ordinary session alone", async () => {
    const cookie = await verifiedUser();
    const { secret } = await enableTwoFactor(cookie);
    await ageAuthentication(cookie, 30);

    const response = await post("/auth/2fa/disable", { code: await freshCode(secret) }, cookie);
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("REAUTHENTICATION_REQUIRED");
    expect(await t.prisma.userTwoFactor.count()).toBe(1);
  });

  it("cannot be unlocked by a flag sent by the client", async () => {
    const cookie = await verifiedUser();
    const { secret } = await enableTwoFactor(cookie);
    await ageAuthentication(cookie, 30);
    const flags = { reauthenticated: true, recentlyAuthenticated: true, authenticatedAt: new Date().toISOString() };

    const response = await post("/auth/2fa/disable", { code: await freshCode(secret), ...flags }, cookie, {
      "x-reauthenticated": "true",
      "x-authenticated-at": new Date().toISOString(),
    });
    expect(response.status).toBe(403);
    expect(await t.prisma.userTwoFactor.count()).toBe(1);
  });

  it("needs a current authenticator code, not a recovery code", async () => {
    const cookie = await verifiedUser();
    const { recoveryCodes } = await enableTwoFactor(cookie);
    expect((await post("/auth/2fa/disable", {}, cookie)).status).toBe(400);
    expect((await post("/auth/2fa/disable", { code: "000000" }, cookie)).status).toBe(400);
    expect((await post("/auth/2fa/disable", { code: recoveryCodes[0]! }, cookie)).status).toBe(400);
    expect(await t.prisma.userTwoFactor.count()).toBe(1);
    expect(await t.prisma.recoveryCode.count()).toBe(10);
  });

  it("turns it off after reauthentication with a valid code: recovery codes go, event and email follow", async () => {
    const cookie = await verifiedUser();
    const { secret } = await enableTwoFactor(cookie);
    await ageAuthentication(cookie, 30);
    expect((await post("/auth/reauthenticate", { password: PASSWORD }, cookie)).status).toBe(204);

    const response = await post("/auth/2fa/disable", { code: await freshCode(secret) }, cookie);
    expect(response.status).toBe(204);
    expect(await t.prisma.userTwoFactor.count()).toBe(0);
    expect(await t.prisma.recoveryCode.count()).toBe(0);
    expect((await get("/auth/session", cookie)).status).toBe(200); // not signed out
    expect((await t.prisma.authEvent.findMany({ where: { type: "TWO_FACTOR_DISABLED" } })).length).toBe(1);
    expect((await securityEmail("was turned off")).to).toBe(EMAIL);

    // Sign-in no longer asks for it.
    const next = await login();
    expect(sessionCookie(next)).toBeTruthy();
    expect(responseCookie(next, "login-challenge")).toBeUndefined();
    expect(await errorCode(await post("/auth/2fa/disable", { code: "123456" }, cookie))).toBe("TWO_FACTOR_NOT_ENABLED");
  });

  it("limits attempts", async () => {
    const cookie = await verifiedUser();
    await enableTwoFactor(cookie);
    for (let i = 0; i < 10; i++) expect((await post("/auth/2fa/disable", { code: "000000" }, cookie)).status).toBe(400);
    expect((await post("/auth/2fa/disable", { code: "000000" }, cookie)).status).toBe(429);
  });
});

describe("reauthentication", () => {
  it("stamps the session on the right password and fails on a wrong one", async () => {
    const cookie = await verifiedUser();
    await ageAuthentication(cookie, 30);
    const status = async () => ((await (await get("/auth/security", cookie)).json()) as SecurityStatus).recentlyAuthenticated;
    expect(await status()).toBe(false);

    const wrong = await post("/auth/reauthenticate", { password: "not-the-password" }, cookie);
    expect(wrong.status).toBe(401);
    expect(await errorCode(wrong)).toBe("INVALID_CREDENTIALS");
    expect(await status()).toBe(false);

    expect((await post("/auth/reauthenticate", { password: PASSWORD }, cookie)).status).toBe(204);
    expect(await status()).toBe(true);
    const types = (await t.prisma.authEvent.findMany()).map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining(["REAUTHENTICATION_FAILED", "REAUTHENTICATION_SUCCESS"]));
  });

  it("expires after ten minutes", async () => {
    const cookie = await verifiedUser();
    const { secret } = await enableTwoFactor(cookie);
    await ageAuthentication(cookie, 9);
    expect(((await (await get("/auth/security", cookie)).json()) as SecurityStatus).recentlyAuthenticated).toBe(true);
    await ageAuthentication(cookie, 11);
    expect(((await (await get("/auth/security", cookie)).json()) as SecurityStatus).recentlyAuthenticated).toBe(false);
    expect((await post("/auth/2fa/recovery-codes", { code: await freshCode(secret) }, cookie)).status).toBe(403);
  });

  it("applies to one session only", async () => {
    const first = await verifiedUser();
    const second = sessionCookie(await login())!;
    await ageAuthentication(first, 30);
    await ageAuthentication(second, 30);
    await post("/auth/reauthenticate", { password: PASSWORD }, first);
    const status = async (cookie: string) => ((await (await get("/auth/security", cookie)).json()) as SecurityStatus).recentlyAuthenticated;
    expect(await status(first)).toBe(true);
    expect(await status(second)).toBe(false);
  });

  it("requires signing in and limits attempts", async () => {
    expect((await post("/auth/reauthenticate", { password: PASSWORD })).status).toBe(401);
    const cookie = await verifiedUser();
    for (let i = 0; i < 10; i++) expect((await post("/auth/reauthenticate", { password: "wrong-password" }, cookie)).status).toBe(401);
    expect((await post("/auth/reauthenticate", { password: PASSWORD }, cookie)).status).toBe(429);
  });

  it("is done through Google for accounts without a password", async () => {
    const cookie = sessionCookie(await googleSignIn())!;
    expect(((await (await get("/auth/security", cookie)).json()) as SecurityStatus).hasPassword).toBe(false);
    expect((await post("/auth/reauthenticate", { password: PASSWORD }, cookie)).status).toBe(403);

    await ageAuthentication(cookie, 30);
    const start = await post("/auth/google/reauth", undefined, cookie);
    expect(start.status).toBe(200);
    const { authorizationUrl } = (await start.json()) as { authorizationUrl: string };
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    const binding = responseCookie(start, "oauth-binding")!;
    const callback = (identityState: string, code: string, cookies: (string | undefined)[]) =>
      t.request(`/auth/google/callback?${new URLSearchParams({ state: identityState, code })}`, { cookie: cookies.filter(Boolean).join("; "), redirect: "manual" });

    // Someone else's Google account does not count.
    const stranger = await callback(state, t.google.approve(state, { subject: "other", email: "other@gmail.test" }), [binding, cookie]);
    expect(stranger.headers.get("location")).toBe("http://localhost:3000/profile?reauth=failed");
    expect(((await (await get("/auth/security", cookie)).json()) as SecurityStatus).recentlyAuthenticated).toBe(false);

    const again = await post("/auth/google/reauth", undefined, cookie);
    const state2 = new URL(((await again.json()) as { authorizationUrl: string }).authorizationUrl).searchParams.get("state")!;
    const ok = await callback(state2, t.google.approve(state2, GINA), [responseCookie(again, "oauth-binding"), cookie]);
    expect(ok.headers.get("location")).toBe("http://localhost:3000/profile?reauth=ok");
    expect(((await (await get("/auth/security", cookie)).json()) as SecurityStatus).recentlyAuthenticated).toBe(true);
  });

  it("is not possible through Google without a session, or with another user's session", async () => {
    expect((await post("/auth/google/reauth")).status).toBe(401);
    const cookie = sessionCookie(await googleSignIn())!;
    const other = await verifiedUser("bob@example.com");
    await ageAuthentication(other, 30);

    const start = await post("/auth/google/reauth", undefined, cookie);
    const state = new URL(((await start.json()) as { authorizationUrl: string }).authorizationUrl).searchParams.get("state")!;
    const code = t.google.approve(state, GINA);
    const response = await t.request(`/auth/google/callback?${new URLSearchParams({ state, code })}`, {
      cookie: [responseCookie(start, "oauth-binding"), other].join("; "),
      redirect: "manual",
    });
    expect(response.headers.get("location")).toBe("http://localhost:3000/profile?reauth=failed");
    expect(((await (await get("/auth/security", other)).json()) as SecurityStatus).recentlyAuthenticated).toBe(false);
  });
});

describe("sessions", () => {
  it("lists the user's live sessions with safe details and marks this one", async () => {
    const first = await verifiedUser(EMAIL, { "user-agent": CHROME_WINDOWS });
    const second = sessionCookie(await login(EMAIL, PASSWORD, { "user-agent": FIREFOX_MAC }))!;
    await verifiedUser("bob@example.com");

    const response = await get("/auth/sessions", first);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { sessions: Record<string, unknown>[] };
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.filter((session) => session.current)).toHaveLength(1);
    expect(Object.keys(body.sessions[0]!).sort()).toEqual(["createdAt", "current", "device", "id", "ipAddress", "lastActiveAt"]);

    const text = JSON.stringify(body);
    for (const secret of [cookieValue(first), cookieValue(second), hashToken(cookieValue(first)), hashToken(cookieValue(second))]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain("tokenHash");

    const firstView = body.sessions.find((session) => session.current)!;
    expect(firstView.device).toEqual({ browser: "Chrome", os: "Windows" });
    expect(firstView.ipAddress).toMatch(/127\.0\.0\.1/);
    const secondBody = (await (await get("/auth/sessions", second)).json()) as { sessions: { current: boolean; device: unknown }[] };
    expect(secondBody.sessions.find((session) => session.current)!.device).toEqual({ browser: "Firefox", os: "macOS" });
  });

  it("omits revoked and expired sessions", async () => {
    const first = await verifiedUser();
    const second = sessionCookie(await login())!;
    await t.prisma.session.update({ where: { tokenHash: hashToken(cookieValue(second)) }, data: { revokedAt: new Date() } });
    const body = (await (await get("/auth/sessions", first)).json()) as { sessions: unknown[] };
    expect(body.sessions).toHaveLength(1);
  });

  it("revokes one session server-side, keeping the record", async () => {
    const first = await verifiedUser();
    const second = sessionCookie(await login())!;
    const list = (await (await get("/auth/sessions", first)).json()) as { sessions: { id: string; current: boolean }[] };
    const other = list.sessions.find((session) => !session.current)!;

    expect((await post(`/auth/sessions/${other.id}/revoke`, undefined, first)).status).toBe(204);
    expect((await get("/auth/session", second)).status).toBe(401);
    expect((await get("/auth/session", first)).status).toBe(200);

    const row = await t.prisma.session.findUniqueOrThrow({ where: { id: other.id } });
    expect(row.revokedAt).not.toBeNull();
    const event = await t.prisma.authEvent.findFirstOrThrow({ where: { type: "SESSION_REVOKED", sessionId: other.id } });
    expect(event.userId).toBe(row.userId);
    expect(await errorCode(await post(`/auth/sessions/${other.id}/revoke`, undefined, first))).toBe("NOT_FOUND"); // already revoked
  });

  it("will not revoke the current session, another user's session, or a made-up id", async () => {
    const alex = await verifiedUser();
    const bob = await verifiedUser("bob@example.com");
    const alexList = (await (await get("/auth/sessions", alex)).json()) as { sessions: { id: string }[] };
    const bobList = (await (await get("/auth/sessions", bob)).json()) as { sessions: { id: string }[] };

    expect((await post(`/auth/sessions/${alexList.sessions[0]!.id}/revoke`, undefined, alex)).status).toBe(400);
    expect((await get("/auth/session", alex)).status).toBe(200);
    expect((await post(`/auth/sessions/${bobList.sessions[0]!.id}/revoke`, undefined, alex)).status).toBe(404);
    expect((await get("/auth/session", bob)).status).toBe(200);
    for (const id of ["not-a-uuid", "00000000-0000-4000-8000-000000000000", "revoke-others"]) {
      expect((await post(`/auth/sessions/${id}/revoke`, undefined, alex)).status).toBe(404);
    }
  });

  it("signs out all other devices and keeps this one", async () => {
    const first = await verifiedUser();
    const others = [sessionCookie(await login())!, sessionCookie(await login())!];
    const bob = await verifiedUser("bob@example.com");

    const response = await post("/auth/sessions/revoke-others", undefined, first);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: 2 });
    expect((await get("/auth/session", first)).status).toBe(200);
    for (const cookie of others) expect((await get("/auth/session", cookie)).status).toBe(401);
    expect((await get("/auth/session", bob)).status).toBe(200); // other users untouched

    expect(await t.prisma.session.count({ where: { revokedAt: { not: null } } })).toBe(2); // kept for audit
    const event = await t.prisma.authEvent.findFirstOrThrow({ where: { type: "SESSIONS_REVOKED" } });
    expect(event.metadata).toEqual({ count: 2 });
  });

  it("needs a signed-in user and a trusted origin", async () => {
    expect((await get("/auth/sessions")).status).toBe(401);
    expect((await post("/auth/sessions/revoke-others")).status).toBe(401);
    expect((await get("/auth/security")).status).toBe(401);
    const cookie = await verifiedUser();
    const forged = await t.request("/auth/sessions/revoke-others", { method: "POST", cookie, origin: "https://evil.example" });
    expect(forged.status).toBe(403);
  });
});

describe("password change", () => {
  const NEW_PASSWORD = "brand-new-lantern-77";
  const change = (cookie: string, body: Record<string, unknown>) => post("/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, ...body }, cookie);

  it("requires the current password", async () => {
    const cookie = await verifiedUser();
    const before = await t.prisma.emailAccount.findFirstOrThrow();
    const wrong = await change(cookie, { currentPassword: "not-my-password" });
    expect(wrong.status).toBe(401);
    expect(await errorCode(wrong)).toBe("INVALID_CREDENTIALS");
    expect((await post("/auth/change-password", { newPassword: NEW_PASSWORD }, cookie)).status).toBe(400);
    expect((await t.prisma.emailAccount.findFirstOrThrow()).passwordHash).toBe(before.passwordHash);
    expect((await t.prisma.authEvent.findMany({ where: { type: "REAUTHENTICATION_FAILED" } })).length).toBe(1);
  });

  it("enforces the password policy", async () => {
    const cookie = await verifiedUser();
    for (const newPassword of ["short", "password123", PASSWORD, "alex-is-the-best-1"]) {
      const response = await change(cookie, { newPassword });
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("VALIDATION_FAILED");
    }
    expect((await login()).status).toBe(200);
  });

  it("changes the hash, revokes other sessions, keeps this one, and records and announces it", async () => {
    const cookie = await verifiedUser();
    const other = sessionCookie(await login())!;
    const before = await t.prisma.emailAccount.findFirstOrThrow();
    await ageAuthentication(cookie, 30);

    const response = await change(cookie, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "password_changed", revokedSessions: 1 });

    const after = await t.prisma.emailAccount.findFirstOrThrow();
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect((await get("/auth/session", cookie)).status).toBe(200);
    expect((await get("/auth/session", other)).status).toBe(401);
    expect(((await (await get("/auth/security", cookie)).json()) as SecurityStatus).recentlyAuthenticated).toBe(true);
    expect((await login(EMAIL, PASSWORD)).status).toBe(401);
    expect((await login(EMAIL, NEW_PASSWORD)).status).toBe(200);

    const event = await t.prisma.authEvent.findFirstOrThrow({ where: { type: "PASSWORD_CHANGED" } });
    expect(event.metadata).toEqual({ revokedSessions: 1 });
    expect(JSON.stringify(event)).not.toContain(NEW_PASSWORD);
    const email = await securityEmail("password was changed");
    expect(email.text).toContain(brand.name);
    expect(email.text).not.toContain(NEW_PASSWORD);
    expect(email.text).not.toContain(PASSWORD);
  });

  it("invalidates outstanding password reset links", async () => {
    const cookie = await verifiedUser();
    await post("/auth/forgot-password", { email: EMAIL });
    await vi.waitFor(() => expect(t.emails.sent.some((message) => message.text.includes("/reset-password#token="))).toBe(true));
    const token = t.resetToken(EMAIL);
    expect((await change(cookie, {})).status).toBe(200);
    expect((await post("/auth/reset-password", { token, password: "yet-another-passphrase-31" })).status).toBe(400);
  });

  it("also needs an authenticator code when two-factor is on", async () => {
    const cookie = await verifiedUser();
    const { secret } = await enableTwoFactor(cookie);
    const missing = await change(cookie, {});
    expect(missing.status).toBe(401);
    expect(await errorCode(missing)).toBe("TWO_FACTOR_CODE_INVALID");
    expect((await change(cookie, { code: "000000" })).status).toBe(401);
    expect((await login(EMAIL, PASSWORD)).status).toBe(200); // password unchanged

    expect((await change(cookie, { code: await freshCode(secret) })).status).toBe(200);
    expect(await t.prisma.userTwoFactor.count()).toBe(1); // 2FA survives a password change
  });

  it("is not available to accounts without a password, and needs a session", async () => {
    const google = sessionCookie(await googleSignIn())!;
    expect((await change(google, {})).status).toBe(403);
    expect((await post("/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(401);
  });

  it("limits attempts", async () => {
    const cookie = await verifiedUser();
    for (let i = 0; i < 5; i++) expect((await change(cookie, { currentPassword: "wrong-password-x" })).status).toBe(401);
    expect((await change(cookie, {})).status).toBe(429);
  });
});

describe("password reset keeps two-factor", () => {
  it("revokes sessions but leaves the authenticator and recovery codes in place", async () => {
    const cookie = await verifiedUser();
    const { secret } = await enableTwoFactor(cookie);
    await post("/auth/forgot-password", { email: EMAIL });
    await vi.waitFor(() => expect(t.emails.sent.some((message) => message.text.includes("/reset-password#token="))).toBe(true));
    expect((await post("/auth/reset-password", { token: t.resetToken(EMAIL), password: "brand-new-lantern-77" })).status).toBe(200);

    expect((await get("/auth/session", cookie)).status).toBe(401);
    expect(await t.prisma.userTwoFactor.count()).toBe(1);
    expect(await t.prisma.recoveryCode.count({ where: { usedAt: null } })).toBe(10);

    const response = await login(EMAIL, "brand-new-lantern-77");
    expect(await response.json()).toEqual({ status: "two_factor_required" });
    const done = await post("/auth/2fa/verify", { code: await freshCode(secret) }, responseCookie(response, "login-challenge"));
    expect(done.status).toBe(200);
  });
});

describe("new sign-in notices", () => {
  it("emails only when a browser or device is new, never for the first session or a repeat", async () => {
    await verifiedUser(EMAIL, { "user-agent": CHROME_WINDOWS });
    await login(EMAIL, PASSWORD, { "user-agent": CHROME_WINDOWS });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(t.emails.sent.filter((message) => message.subject.includes("New sign-in"))).toHaveLength(0);
    expect(await t.prisma.authEvent.count({ where: { type: "NEW_LOGIN" } })).toBe(0);

    await login(EMAIL, PASSWORD, { "user-agent": FIREFOX_MAC });
    const email = await securityEmail("New sign-in");
    expect(email.to).toBe(EMAIL);
    expect(email.text).toContain("Firefox on macOS");
    expect(email.text).toContain(brand.name);
    expect(email.text).not.toContain(PASSWORD);
    expect(email.text).not.toMatch(/token|session/i);
    expect(await t.prisma.authEvent.count({ where: { type: "NEW_LOGIN" } })).toBe(1);

    await login(EMAIL, PASSWORD, { "user-agent": FIREFOX_MAC });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(t.emails.sent.filter((message) => message.subject.includes("New sign-in"))).toHaveLength(1);
  });

  it("never blocks the sign-in, even when the email cannot be sent", async () => {
    await verifiedUser(EMAIL, { "user-agent": CHROME_WINDOWS });
    t.emails.failNext(new Error("smtp down"));
    const response = await login(EMAIL, PASSWORD, { "user-agent": FIREFOX_MAC });
    expect(response.status).toBe(200);
    expect(sessionCookie(response)).toBeTruthy();
  });
});

describe("secrets stay out of logs, events and emails", () => {
  it("never records TOTP secrets, codes, recovery codes, challenge or session tokens, or passwords", async () => {
    const output: string[] = [];
    const capture = (chunk: string | Uint8Array) => {
      output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    };
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = capture as typeof process.stdout.write;
    process.stderr.write = capture as typeof process.stderr.write;

    const secrets: string[] = [];
    try {
      const cookie = await verifiedUser();
      const setup = (await (await post("/auth/2fa/setup", undefined, cookie)).json()) as TwoFactorSetup;
      const enableCode = totpCode(setup.secret, totpStep(Date.now()));
      const { recoveryCodes } = (await (await post("/auth/2fa/confirm", { code: enableCode }, cookie)).json()) as RecoveryCodesResponse;
      await post("/auth/2fa/confirm", { code: "000000" }, cookie);

      const challenge = await startChallenge();
      const wrong = "654321";
      await post("/auth/2fa/verify", { code: wrong }, challenge);
      const loginCode = await freshCode(setup.secret);
      const signedIn = sessionCookie(await post("/auth/2fa/verify", { code: loginCode }, challenge))!;
      const recoveryChallenge = await startChallenge();
      await post("/auth/2fa/recovery", { code: recoveryCodes[0]! }, recoveryChallenge);
      await post("/auth/change-password", { currentPassword: PASSWORD, newPassword: "brand-new-lantern-77", code: await freshCode(setup.secret) }, signedIn);
      await post("/auth/reauthenticate", { password: "brand-new-lantern-77" }, signedIn);
      await post("/auth/2fa/recovery-codes", { code: await freshCode(setup.secret) }, signedIn);
      await post("/auth/2fa/disable", { code: await freshCode(setup.secret) }, signedIn);
      await new Promise((resolve) => setTimeout(resolve, 300));

      secrets.push(
        setup.secret,
        enableCode,
        loginCode,
        ...recoveryCodes,
        ...recoveryCodes.map((code) => code.replaceAll("-", "")),
        cookieValue(challenge),
        cookieValue(recoveryChallenge),
        cookieValue(signedIn),
        hashToken(cookieValue(signedIn)),
        PASSWORD,
        "brand-new-lantern-77",
      );
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }

    const logs = output.join("");
    expect(logs).toContain("POST /api/v1/auth/2fa/verify"); // logging was captured
    const events = JSON.stringify(await t.prisma.authEvent.findMany());
    const emails = JSON.stringify(t.emails.sent);
    for (const secret of secrets) {
      expect(logs).not.toContain(secret);
      expect(events).not.toContain(secret);
      expect(emails).not.toContain(secret);
    }
  });
});

describe("hardening", () => {
  const WRONG_RECOVERY = "ABCD-EFGH-JKLM-NPQR";
  const redisDown = () =>
    vi.spyOn(t.redis.client, "multi").mockImplementation(() => {
      throw new Error("redis down");
    });

  describe("secret at rest", () => {
    it("fails closed, without a session, when a stored secret cannot be decrypted", async () => {
      const { recoveryCodes } = await enableTwoFactor(await verifiedUser());
      const bob = await enableTwoFactor(await verifiedUser("bob@example.com"));

      // A ciphertext copied onto another user's row is bound to its owner and must not decrypt there.
      const rows = await t.prisma.userTwoFactor.findMany({ include: { user: { include: { emailAccount: true } } } });
      const alexRow = rows.find((row) => row.user.emailAccount?.email === EMAIL)!;
      const bobRow = rows.find((row) => row.user.emailAccount?.email === "bob@example.com")!;
      await t.prisma.userTwoFactor.update({ where: { id: alexRow.id }, data: { encryptedSecret: bobRow.encryptedSecret } });

      const challenge = await startChallenge();
      const sessions = await t.prisma.session.count();
      const response = await post("/auth/2fa/verify", { code: await freshCode(bob.secret) }, challenge);
      expect(response.status).toBe(503);
      expect(sessionCookie(response)).toBeUndefined();
      expect(await t.prisma.session.count()).toBe(sessions);
      expect((await t.prisma.authChallenge.findFirstOrThrow({ where: { userId: alexRow.userId } })).consumedAt).toBeNull();

      // Recovery codes don't depend on the secret, so the person is not locked out.
      expect((await post("/auth/2fa/recovery", { code: recoveryCodes[0]! }, challenge)).status).toBe(200);
    });

    it("never exposes the TOTP secret or its ciphertext through any API response after setup", async () => {
      const cookie = await verifiedUser();
      const { secret } = await enableTwoFactor(cookie);
      const stored = (await t.prisma.userTwoFactor.findFirstOrThrow()).encryptedSecret;

      const responses = [
        await get("/auth/session", cookie),
        await get("/auth/security", cookie),
        await get("/auth/sessions", cookie),
        await post("/auth/2fa/setup", undefined, cookie), // refused: already enabled
        await post("/auth/2fa/confirm", { code: "123456" }, cookie),
        await post("/auth/2fa/disable", { code: "000000" }, cookie),
        await login(),
      ];
      for (const response of responses) {
        const text = await response.text();
        expect(text).not.toContain(secret);
        expect(text).not.toContain(stored);
        expect(text).not.toMatch(/encryptedSecret|otpauth:/);
      }
    });
  });

  describe("recovery-code limits", () => {
    it("cannot regenerate with a recovery code, and keeps the existing set", async () => {
      const cookie = await verifiedUser();
      const { recoveryCodes } = await enableTwoFactor(cookie);
      expect((await post("/auth/2fa/recovery-codes", { code: recoveryCodes[0]! }, cookie)).status).toBe(400);
      expect(await t.prisma.recoveryCode.count({ where: { usedAt: null } })).toBe(10);
    });

    it("kills a challenge after repeated wrong recovery codes without spending a real one", async () => {
      const { recoveryCodes } = await enableTwoFactor(await verifiedUser());
      const challenge = await startChallenge();
      for (let i = 0; i < 5; i++) {
        const response = await post("/auth/2fa/recovery", { code: WRONG_RECOVERY }, challenge);
        expect(response.status).toBe(401);
        expect(await errorCode(response)).toBe("TWO_FACTOR_CODE_INVALID");
      }
      const dead = await post("/auth/2fa/recovery", { code: recoveryCodes[0]! }, challenge);
      expect(await errorCode(dead)).toBe("TWO_FACTOR_CHALLENGE_INVALID");
      expect(sessionCookie(dead)).toBeUndefined();
      expect(await t.prisma.recoveryCode.count({ where: { usedAt: { not: null } } })).toBe(0);
    });
  });

  describe("Google-only accounts", () => {
    it("need Google reauthentication to turn two-factor off, and are emailed at their Google address", async () => {
      const cookie = sessionCookie(await googleSignIn())!;
      const { secret } = await enableTwoFactor(cookie);
      await ageAuthentication(cookie, 30);

      const stale = await post("/auth/2fa/disable", { code: await freshCode(secret) }, cookie);
      expect(stale.status).toBe(403);
      expect(await errorCode(stale)).toBe("REAUTHENTICATION_REQUIRED");
      expect((await post("/auth/reauthenticate", { password: PASSWORD }, cookie)).status).toBe(403); // no password to guess
      expect(await t.prisma.userTwoFactor.count()).toBe(1);

      const start = await post("/auth/google/reauth", undefined, cookie);
      const state = new URL(((await start.json()) as { authorizationUrl: string }).authorizationUrl).searchParams.get("state")!;
      const done = await t.request(`/auth/google/callback?${new URLSearchParams({ state, code: t.google.approve(state, GINA) })}`, {
        cookie: [responseCookie(start, "oauth-binding"), cookie].join("; "),
        redirect: "manual",
      });
      expect(done.headers.get("location")).toBe("http://localhost:3000/profile?reauth=ok");

      expect((await post("/auth/2fa/disable", { code: await freshCode(secret) }, cookie)).status).toBe(204);
      expect(await t.prisma.userTwoFactor.count()).toBe(0);
      expect((await securityEmail("was turned off")).to).toBe(GINA.email);
    });
  });

  describe("CSRF and login CSRF", () => {
    it("refuses every state-changing security request from a foreign or missing origin, changing nothing", async () => {
      const cookie = await verifiedUser();
      const other = sessionCookie(await login())!;
      const { secret, recoveryCodes } = await enableTwoFactor(cookie);
      const challenge = await startChallenge();
      const before = await t.prisma.emailAccount.findFirstOrThrow();
      const code = await freshCode(secret);

      const attempts: [string, unknown, string][] = [
        ["/auth/2fa/verify", { code }, challenge],
        ["/auth/2fa/recovery", { code: recoveryCodes[0]! }, challenge],
        ["/auth/2fa/setup", {}, cookie],
        ["/auth/2fa/confirm", { code }, cookie],
        ["/auth/2fa/disable", { code }, cookie],
        ["/auth/2fa/recovery-codes", { code }, cookie],
        ["/auth/reauthenticate", { password: PASSWORD }, cookie],
        ["/auth/change-password", { currentPassword: PASSWORD, newPassword: "brand-new-lantern-77", code }, cookie],
        ["/auth/sessions/revoke-others", {}, cookie],
      ];
      for (const origin of ["https://evil.example", null]) {
        for (const [path, body, requestCookie] of attempts) {
          const response = await t.request(path, { method: "POST", body, cookie: requestCookie, origin });
          expect(response.status, `${path} from ${origin}`).toBe(403);
          expect(await errorCode(response)).toBe("FORBIDDEN_ORIGIN");
          expect(sessionCookie(response)).toBeUndefined();
        }
      }

      expect(await t.prisma.userTwoFactor.count()).toBe(1);
      expect(await t.prisma.recoveryCode.count({ where: { usedAt: null } })).toBe(10);
      expect((await t.prisma.emailAccount.findFirstOrThrow()).passwordHash).toBe(before.passwordHash);
      expect((await get("/auth/session", other)).status).toBe(200);
      const pending = await t.prisma.authChallenge.findFirstOrThrow();
      expect(pending.consumedAt).toBeNull();
      expect(pending.attempts).toBe(0);
      expect((await post("/auth/2fa/verify", { code }, challenge)).status).toBe(200); // the real browser still can
    });
  });

  describe("rate limits and Redis failure", () => {
    it("fails closed on every sensitive endpoint when Redis is unavailable, changing nothing", async () => {
      const cookie = await verifiedUser();
      const other = sessionCookie(await login())!;
      const { secret, recoveryCodes } = await enableTwoFactor(cookie);
      const challenge = await startChallenge();
      const before = await t.prisma.emailAccount.findFirstOrThrow();
      const code = await freshCode(secret);

      redisDown();
      const attempts: [string, unknown, string][] = [
        ["/auth/2fa/recovery", { code: recoveryCodes[0]! }, challenge],
        ["/auth/reauthenticate", { password: PASSWORD }, cookie],
        ["/auth/change-password", { currentPassword: PASSWORD, newPassword: "brand-new-lantern-77", code }, cookie],
        ["/auth/2fa/disable", { code }, cookie],
        ["/auth/2fa/recovery-codes", { code }, cookie],
        ["/auth/sessions/revoke-others", {}, cookie],
      ];
      for (const [path, body, requestCookie] of attempts) {
        const response = await post(path, body, requestCookie);
        expect(response.status, path).toBe(503);
        expect(sessionCookie(response)).toBeUndefined();
      }
      vi.restoreAllMocks();

      expect(await t.prisma.userTwoFactor.count()).toBe(1);
      expect(await t.prisma.recoveryCode.count({ where: { usedAt: null } })).toBe(10);
      expect((await t.prisma.emailAccount.findFirstOrThrow()).passwordHash).toBe(before.passwordHash);
      expect((await get("/auth/session", other)).status).toBe(200);
      expect((await post("/auth/2fa/verify", { code }, challenge)).status).toBe(200); // challenge untouched
    });

    it("limits starting setup", async () => {
      const cookie = await verifiedUser();
      for (let i = 0; i < 5; i++) expect((await post("/auth/2fa/setup", undefined, cookie)).status).toBe(200);
      const limited = await post("/auth/2fa/setup", undefined, cookie);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBeTruthy();
    });

    it("limits session revocation", async () => {
      const cookie = await verifiedUser();
      for (let i = 0; i < 30; i++) expect((await post("/auth/sessions/revoke-others", undefined, cookie)).status).toBe(200);
      expect((await post("/auth/sessions/revoke-others", undefined, cookie)).status).toBe(429);
    });
  });
});
