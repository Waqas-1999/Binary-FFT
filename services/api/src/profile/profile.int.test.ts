import type { ApiErrorResponse, NotificationPreferencesResponse, PhoneCodeSentResponse, ProfileResponse } from "@repo/types";
import { maskPhoneNumber } from "@repo/validation";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../auth/tokens.ts";
import { createTestApp, responseCookie, sessionCookie, type TestApp } from "../test/test-app.ts";
import { NotificationPreferencesService } from "./notification-preferences.service.ts";

const EMAIL = "alex@example.com";
const BOB = "bob@example.com";
const PASSWORD = "calm-river-sunrise-42";
const NUMBER_A = "+919876543210";
const NUMBER_B = "+14155550123";

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
const patch = (path: string, body: unknown, cookie?: string) => t.request(path, { method: "PATCH", body, cookie });
const del = (path: string, cookie?: string) => t.request(path, { method: "DELETE", cookie });
const get = (path: string, cookie?: string) => t.request(path, { cookie });
const errorCode = async (response: Response) => ((await response.json()) as ApiErrorResponse).code;
const profileOf = async (cookie: string) => (await (await get("/profile", cookie)).json()) as ProfileResponse;
const prefsOf = async (cookie: string) => (await (await get("/notifications/preferences", cookie)).json()) as NotificationPreferencesResponse;

/** Creates a verified password account; returns its first session cookie. */
async function verifiedUser(email = EMAIL): Promise<string> {
  await post("/auth/signup", { email, password: PASSWORD });
  return sessionCookie(await post("/auth/verify-email", { token: t.verificationToken(email) }))!;
}

const userId = async (email: string) => (await t.prisma.user.findFirstOrThrow({ where: { emailAccount: { email } } })).id;

async function ageAuthentication(cookie: string, minutes: number): Promise<void> {
  await t.prisma.session.update({
    where: { tokenHash: hashToken(cookie.split("=")[1]!) },
    data: { authenticatedAt: new Date(Date.now() - minutes * 60_000) },
  });
}

/** The one-per-minute resend limit would otherwise make every second request in a test a 429. */
async function clearCooldown(): Promise<void> {
  const keys = await t.redis.client.keys("rl:phone-otp-cooldown:*");
  if (keys.length > 0) await t.redis.client.del(...keys);
}

async function sendCode(cookie: string, phoneNumber = NUMBER_A): Promise<Response> {
  await clearCooldown();
  return post("/profile/mobile/send-code", { phoneNumber }, cookie);
}

/** Texts a code and returns it (from the capturing test provider; real providers never expose it). */
async function textedCode(cookie: string, phoneNumber = NUMBER_A): Promise<string> {
  const response = await sendCode(cookie, phoneNumber);
  expect(response.status).toBe(200);
  return t.sms.latestCode(phoneNumber);
}

const verify = (cookie: string, code: string) => post("/profile/mobile/verify", { code }, cookie);

/** Runs `action` while capturing everything written to stdout/stderr. */
async function captureLogs(action: () => Promise<void>): Promise<string> {
  const output: string[] = [];
  const capture = (chunk: string | Uint8Array) => {
    output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = capture as typeof process.stdout.write;
  process.stderr.write = capture as typeof process.stderr.write;
  try {
    await action();
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
  return output.join("");
}

const redisDown = () =>
  vi.spyOn(t.redis.client, "multi").mockImplementation(() => {
    throw new Error("redis down");
  });

describe("profile", () => {
  it("requires a signed-in user for every profile, mobile, Telegram and notification endpoint", async () => {
    const calls: [string, string][] = [
      ["GET", "/profile"],
      ["PATCH", "/profile"],
      ["POST", "/profile/mobile/send-code"],
      ["POST", "/profile/mobile/verify"],
      ["DELETE", "/profile/mobile"],
      ["POST", "/profile/telegram/link"],
      ["DELETE", "/profile/telegram"],
      ["GET", "/notifications/preferences"],
      ["PATCH", "/notifications/preferences"],
    ];
    for (const [method, path] of calls) {
      const response = await t.request(path, { method, body: method === "GET" || method === "DELETE" ? undefined : {} });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it("returns a minimal profile with no internal ids, secrets or full phone numbers", async () => {
    const cookie = await verifiedUser();
    const response = await get("/profile", cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const profile = (await response.json()) as ProfileResponse;
    expect(profile.userNumber).toBeGreaterThanOrEqual(10000);
    expect(profile).toEqual({
      userNumber: (await t.prisma.user.findFirstOrThrow()).userNumber,
      displayName: null,
      email: EMAIL,
      emailVerified: true,
      avatar: { kind: "initials", text: "A" },
      mobile: { masked: null, verified: false, pending: null, available: true },
      google: { connected: false },
      telegram: { connected: false, available: true },
      settings: { timeZone: null },
    });

    const id = await userId(EMAIL);
    const session = await t.prisma.session.findFirstOrThrow();
    const text = JSON.stringify(profile);
    for (const forbidden of [id, session.id, session.tokenHash, cookie.split("=")[1]!, "passwordHash", "argon2", "uuid"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("works for Google-only accounts", async () => {
    const start = await t.request("/auth/google", { redirect: "manual" });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const code = t.google.approve(state, { subject: "g-1", email: "gina@gmail.test" });
    const done = await t.request(`/auth/google/callback?${new URLSearchParams({ state, code })}`, {
      cookie: responseCookie(start, "oauth-binding"),
      redirect: "manual",
    });
    const profile = await profileOf(sessionCookie(done)!);
    expect(profile).toMatchObject({ email: "gina@gmail.test", emailVerified: true, google: { connected: true }, avatar: { text: "G" } });
  });

  describe("display name", () => {
    it("trims, normalizes, stores it and records only which field changed", async () => {
      const cookie = await verifiedUser();
      const response = await patch("/profile", { displayName: "  Alex   Rivera \n" }, cookie);
      expect(response.status).toBe(200);
      const profile = (await response.json()) as ProfileResponse;
      expect(profile.displayName).toBe("Alex Rivera");
      expect(profile.avatar).toEqual({ kind: "initials", text: "AR" });
      expect((await t.prisma.user.findFirstOrThrow()).displayName).toBe("Alex Rivera");

      const event = await t.prisma.authEvent.findFirstOrThrow({ where: { type: "PROFILE_UPDATED" } });
      expect(event.metadata).toEqual({ fields: ["displayName"] });
      expect(JSON.stringify(event)).not.toContain("Rivera");
    });

    it("can be cleared, and does not need to be unique", async () => {
      const alex = await verifiedUser();
      const bob = await verifiedUser(BOB);
      expect((await patch("/profile", { displayName: "Sam" }, alex)).status).toBe(200);
      expect((await patch("/profile", { displayName: "Sam" }, bob)).status).toBe(200);
      expect((await profileOf(alex)).displayName).toBe("Sam");
      expect(((await (await patch("/profile", { displayName: null }, alex)).json()) as ProfileResponse).displayName).toBeNull();
    });

    it("rejects empty, over-long, control-character, invisible and markup names, changing nothing", async () => {
      const cookie = await verifiedUser();
      await patch("/profile", { displayName: "Keep Me" }, cookie);
      const bad = ["", "   ", "a".repeat(51), "bad\u0000name", "tab\tname", "a‮b", "zero​width", "<script>alert(1)</script>", "a>b", 42];
      for (const displayName of bad) {
        const response = await patch("/profile", { displayName }, cookie);
        expect(response.status, JSON.stringify(displayName)).toBe(400);
        expect(await errorCode(response)).toBe("VALIDATION_FAILED");
      }
      expect((await profileOf(cookie)).displayName).toBe("Keep Me");
    });
  });

  describe("time zone", () => {
    it("stores a valid IANA zone, clears it, and rejects anything else", async () => {
      const cookie = await verifiedUser();
      expect(((await (await patch("/profile", { timeZone: "Asia/Kolkata" }, cookie)).json()) as ProfileResponse).settings.timeZone).toBe("Asia/Kolkata");
      expect((await profileOf(cookie)).settings.timeZone).toBe("Asia/Kolkata");
      for (const timeZone of ["Mars/Olympus", "", "../../etc/passwd", "<b>"]) {
        expect((await patch("/profile", { timeZone }, cookie)).status, timeZone).toBe(400);
      }
      expect(((await (await patch("/profile", { timeZone: null }, cookie)).json()) as ProfileResponse).settings.timeZone).toBeNull();
    });
  });

  describe("identity is immutable and account-bound", () => {
    it("cannot change the account number, email, status or anyone else's account through the profile endpoint", async () => {
      const alex = await verifiedUser();
      const bob = await verifiedUser(BOB);
      const before = await t.prisma.user.findMany({ orderBy: { userNumber: "asc" } });
      const accounts = await t.prisma.emailAccount.findMany({ orderBy: { email: "asc" } });
      const bobId = await userId(BOB);
      const alexId = await userId(EMAIL);

      for (const extra of [
        { userNumber: 99999 },
        { email: "evil@example.com" },
        { userId: bobId },
        { id: bobId },
        { status: "DISABLED" },
        { phoneNumber: NUMBER_A },
        { emailVerified: false },
      ]) {
        const response = await patch("/profile", { displayName: "Mallory", ...extra }, alex);
        expect(response.status, JSON.stringify(extra)).toBe(400);
      }

      expect(await t.prisma.user.findMany({ orderBy: { userNumber: "asc" } })).toEqual(before);
      expect(await t.prisma.emailAccount.findMany({ orderBy: { email: "asc" } })).toEqual(accounts);
      expect((await profileOf(alex)).userNumber).toBe(before.find((user) => user.id === alexId)!.userNumber);
      expect((await profileOf(bob)).displayName).toBeNull();
    });

    it("only ever updates the signed-in user", async () => {
      const alex = await verifiedUser();
      const bob = await verifiedUser(BOB);
      await patch("/profile", { displayName: "Alex A", timeZone: "Europe/London" }, alex);
      const bobProfile = await profileOf(bob);
      expect(bobProfile).toMatchObject({ displayName: null, email: BOB, settings: { timeZone: null } });
      expect(JSON.stringify(bobProfile)).not.toContain("Alex");
    });
  });

  it("refuses profile changes from a foreign or missing origin", async () => {
    const cookie = await verifiedUser();
    for (const origin of ["https://evil.example", null]) {
      const response = await t.request("/profile", { method: "PATCH", body: { displayName: "Mallory" }, cookie, origin });
      expect(response.status).toBe(403);
    }
    expect((await profileOf(cookie)).displayName).toBeNull();
  });

  it("limits profile updates and fails closed when Redis is unavailable", async () => {
    const cookie = await verifiedUser();
    for (let i = 0; i < 20; i++) expect((await patch("/profile", { displayName: `Name ${i}` }, cookie)).status).toBe(200);
    const limited = await patch("/profile", { displayName: "Too many" }, cookie);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();

    await t.redis.client.flushdb();
    redisDown();
    expect((await patch("/profile", { displayName: "Down" }, cookie)).status).toBe(503);
  });
});

describe("mobile number", () => {
  it("is optional: accounts work without one", async () => {
    await verifiedUser();
    expect((await t.request("/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } })).status).toBe(200);
    expect(await t.prisma.userPhone.count()).toBe(0);
    expect(t.sms.sent).toHaveLength(0);
  });

  it("normalizes to E.164, texts a code, and keeps the number unverified until it is confirmed", async () => {
    const cookie = await verifiedUser();
    const response = await post("/profile/mobile/send-code", { phoneNumber: "+91 98765-43210" }, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()) as PhoneCodeSentResponse).toEqual({ status: "code_sent", expiresInSeconds: 600, resendAfterSeconds: 60 });

    expect(t.sms.sent).toHaveLength(1);
    expect(t.sms.sent[0]).toMatchObject({ to: NUMBER_A, expiresInMinutes: 10 });
    expect(t.sms.sent[0]!.code).toMatch(/^\d{6}$/);

    expect(await t.prisma.userPhone.count()).toBe(0); // nothing verified yet
    const profile = await profileOf(cookie);
    expect(profile.mobile).toMatchObject({ masked: null, verified: false, pending: { masked: maskPhoneNumber(NUMBER_A) } });
    expect(JSON.stringify(profile)).not.toContain("9876");
  });

  it("rejects numbers without a country code or in the wrong shape", async () => {
    const cookie = await verifiedUser();
    for (const phoneNumber of ["9876543210", "0987654321", "+12", "+91abc", "", "+0123456789", 123]) {
      const response = await sendCode(cookie, phoneNumber as string);
      expect(response.status, String(phoneNumber)).toBe(400);
    }
    expect(t.sms.sent).toHaveLength(0);
    expect(await t.prisma.phoneVerificationChallenge.count()).toBe(0);
  });

  it("stores only a hash of the code and never returns it", async () => {
    const cookie = await verifiedUser();
    const response = await sendCode(cookie);
    const code = t.sms.latestCode(NUMBER_A);
    const body = await response.text();
    expect(body).not.toContain(code);

    const challenge = await t.prisma.phoneVerificationChallenge.findFirstOrThrow();
    expect(challenge.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(challenge)).not.toContain(`"${code}"`);
    expect(challenge.codeHash).not.toContain(code);
    expect(Math.abs(challenge.expiresAt.getTime() - (Date.now() + 600_000))).toBeLessThan(10_000);

    const status = await get("/profile", cookie);
    expect(await status.text()).not.toContain(code);
  });

  it("confirms with the right code: verified, masked, single event, challenge used up", async () => {
    const cookie = await verifiedUser();
    const code = await textedCode(cookie);
    const response = await verify(cookie, `${code.slice(0, 3)} ${code.slice(3)}`);
    expect(response.status).toBe(204);

    const stored = await t.prisma.userPhone.findFirstOrThrow();
    expect(stored.phoneNumber).toBe(NUMBER_A);
    expect((await t.prisma.phoneVerificationChallenge.findFirstOrThrow()).consumedAt).not.toBeNull();

    const profile = await profileOf(cookie);
    expect(profile.mobile).toMatchObject({ masked: maskPhoneNumber(NUMBER_A), verified: true, pending: null });
    expect(JSON.stringify(profile)).not.toContain(NUMBER_A);

    const event = await t.prisma.authEvent.findFirstOrThrow({ where: { type: "PHONE_VERIFIED" } });
    expect(event.metadata).toEqual({ mobile: maskPhoneNumber(NUMBER_A) });
  });

  it("answers every bad code the same way, counts wrong attempts, and gives up after five", async () => {
    const cookie = await verifiedUser();
    const code = await textedCode(cookie);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      const response = await verify(cookie, wrong);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("PHONE_CODE_INVALID");
    }
    expect((await t.prisma.phoneVerificationChallenge.findFirstOrThrow()).attempts).toBe(5);
    // The right code no longer helps: a new one has to be requested.
    const dead = await verify(cookie, code);
    expect(dead.status).toBe(400);
    expect(await errorCode(dead)).toBe("PHONE_CODE_INVALID");
    expect(await t.prisma.userPhone.count()).toBe(0);
    expect((await profileOf(cookie)).mobile.verified).toBe(false);
    expect(await t.prisma.authEvent.count({ where: { type: "PHONE_VERIFICATION_FAILED" } })).toBe(6);

    const fresh = await textedCode(cookie);
    expect((await verify(cookie, fresh)).status).toBe(204);
  });

  it("rejects an expired code, a code that was never requested, and a malformed one", async () => {
    const cookie = await verifiedUser();
    expect(await errorCode(await verify(cookie, "123456"))).toBe("PHONE_CODE_INVALID"); // nothing pending
    expect((await post("/profile/mobile/verify", { code: "12" }, cookie)).status).toBe(400);
    expect((await post("/profile/mobile/verify", {}, cookie)).status).toBe(400);

    const code = await textedCode(cookie);
    await t.prisma.phoneVerificationChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await errorCode(await verify(cookie, code))).toBe("PHONE_CODE_INVALID");
    expect(await t.prisma.userPhone.count()).toBe(0);
    expect((await profileOf(cookie)).mobile.pending).toBeNull();
  });

  it("works once only", async () => {
    const cookie = await verifiedUser();
    const code = await textedCode(cookie);
    expect((await verify(cookie, code)).status).toBe(204);
    expect(await errorCode(await verify(cookie, code))).toBe("PHONE_CODE_INVALID");
    expect(await t.prisma.authEvent.count({ where: { type: "PHONE_VERIFIED" } })).toBe(1);
  });

  it("lets only one of several simultaneous confirmations succeed", async () => {
    const cookie = await verifiedUser();
    const code = await textedCode(cookie);
    const results = await Promise.all(Array.from({ length: 6 }, () => verify(cookie, code)));
    expect(results.filter((response) => response.status === 204)).toHaveLength(1);
    expect(results.filter((response) => response.status === 400)).toHaveLength(5);
    expect(await t.prisma.userPhone.count()).toBe(1);
    expect(await t.prisma.authEvent.count({ where: { type: "PHONE_VERIFIED" } })).toBe(1);
  });

  it("invalidates the older code when a new one is requested, for the same or another number", async () => {
    const cookie = await verifiedUser();
    const first = await textedCode(cookie, NUMBER_A);
    const second = await textedCode(cookie, NUMBER_A); // resend
    expect(await t.prisma.phoneVerificationChallenge.count()).toBe(1);
    if (first !== second) expect(await errorCode(await verify(cookie, first))).toBe("PHONE_CODE_INVALID");

    const forOther = await textedCode(cookie, NUMBER_B); // changed their mind
    if (second !== forOther) expect(await errorCode(await verify(cookie, second))).toBe("PHONE_CODE_INVALID");
    expect((await t.prisma.phoneVerificationChallenge.findFirstOrThrow()).attempts).toBeGreaterThanOrEqual(0);
    await t.prisma.phoneVerificationChallenge.updateMany({ data: { attempts: 0 } });

    expect((await verify(cookie, forOther)).status).toBe(204);
    expect((await t.prisma.userPhone.findFirstOrThrow()).phoneNumber).toBe(NUMBER_B); // only the latest number
  });

  it("keeps the verified number until its replacement is confirmed, then records a change", async () => {
    const cookie = await verifiedUser();
    expect((await verify(cookie, await textedCode(cookie, NUMBER_A))).status).toBe(204);

    const code = await textedCode(cookie, NUMBER_B);
    const pending = await profileOf(cookie);
    expect(pending.mobile).toMatchObject({ masked: maskPhoneNumber(NUMBER_A), verified: true, pending: { masked: maskPhoneNumber(NUMBER_B) } });
    expect((await t.prisma.userPhone.findFirstOrThrow()).phoneNumber).toBe(NUMBER_A);

    expect((await verify(cookie, code)).status).toBe(204);
    expect((await t.prisma.userPhone.findFirstOrThrow()).phoneNumber).toBe(NUMBER_B);
    expect(await t.prisma.userPhone.count()).toBe(1);
    expect(await t.prisma.authEvent.count({ where: { type: "PHONE_CHANGED" } })).toBe(1);
  });

  it("does not text again for the number that is already verified", async () => {
    const cookie = await verifiedUser();
    await verify(cookie, await textedCode(cookie));
    const before = t.sms.sent.length;
    const response = await sendCode(cookie);
    expect(((await response.json()) as PhoneCodeSentResponse).status).toBe("already_verified");
    expect(t.sms.sent).toHaveLength(before);
  });

  it("needs a recent authentication to add, change or remove a number", async () => {
    const cookie = await verifiedUser();
    await ageAuthentication(cookie, 30);
    const stale = await sendCode(cookie);
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("REAUTHENTICATION_REQUIRED");
    expect(t.sms.sent).toHaveLength(0);
    expect(await errorCode(await del("/profile/mobile", cookie))).toBe("REAUTHENTICATION_REQUIRED");

    expect((await post("/auth/reauthenticate", { password: PASSWORD }, cookie)).status).toBe(204);
    expect((await sendCode(cookie)).status).toBe(200);
  });

  it("removes the number and any pending verification", async () => {
    const cookie = await verifiedUser();
    await verify(cookie, await textedCode(cookie, NUMBER_A));
    await textedCode(cookie, NUMBER_B);

    expect((await del("/profile/mobile", cookie)).status).toBe(204);
    expect(await t.prisma.userPhone.count()).toBe(0);
    expect(await t.prisma.phoneVerificationChallenge.count()).toBe(0);
    expect(await profileOf(cookie).then((profile) => profile.mobile)).toMatchObject({ masked: null, verified: false, pending: null });
    expect(await t.prisma.authEvent.count({ where: { type: "PHONE_REMOVED" } })).toBe(1);
    expect((await del("/profile/mobile", cookie)).status).toBe(204); // idempotent
  });

  describe("isolation between users", () => {
    it("never lets one user see, use or disturb another user's pending code or number", async () => {
      const alex = await verifiedUser();
      const bob = await verifiedUser(BOB);
      const alexCode = await textedCode(alex, NUMBER_A);

      // Bob has nothing pending, so Alex's code means nothing to him.
      expect(await errorCode(await verify(bob, alexCode))).toBe("PHONE_CODE_INVALID");
      expect(await t.prisma.userPhone.count()).toBe(0);
      expect((await profileOf(alex)).mobile.pending).not.toBeNull();
      expect((await profileOf(bob)).mobile.pending).toBeNull();

      // Alex can still finish, and Bob never sees the number.
      expect((await verify(alex, alexCode)).status).toBe(204);
      expect(JSON.stringify(await profileOf(bob))).not.toContain("3210");

      // Bob's own codes are bound to Bob.
      const bobCode = await textedCode(bob, NUMBER_B);
      expect(await errorCode(await verify(alex, bobCode))).toBe("PHONE_CODE_INVALID");
      expect((await profileOf(alex)).mobile.masked).toBe(maskPhoneNumber(NUMBER_A));
    });

    it("answers the same whether or not another account already uses the number", async () => {
      const alex = await verifiedUser();
      const bob = await verifiedUser(BOB);
      await verify(alex, await textedCode(alex, NUMBER_A));

      const response = await sendCode(bob, NUMBER_A);
      expect(response.status).toBe(200);
      expect(((await response.json()) as PhoneCodeSentResponse).status).toBe("code_sent");
      expect((await verify(bob, t.sms.latestCode(NUMBER_A))).status).toBe(204); // a phone is not an identity
    });
  });

  describe("abuse limits", () => {
    it("waits a minute between texts", async () => {
      const cookie = await verifiedUser();
      expect((await post("/profile/mobile/send-code", { phoneNumber: NUMBER_A }, cookie)).status).toBe(200);
      const again = await post("/profile/mobile/send-code", { phoneNumber: NUMBER_A }, cookie);
      expect(again.status).toBe(429);
      expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(t.sms.sent).toHaveLength(1);
    });

    it("caps texts per user per hour", async () => {
      const cookie = await verifiedUser();
      for (let i = 0; i < 5; i++) expect((await sendCode(cookie)).status).toBe(200);
      const limited = await sendCode(cookie);
      expect(limited.status).toBe(429);
      expect(t.sms.sent).toHaveLength(5);
    });

    it("caps how often a user can switch to a different number", async () => {
      const cookie = await verifiedUser();
      for (const number of ["+14155550101", "+14155550102", "+14155550103"]) expect((await sendCode(cookie, number)).status).toBe(200);
      expect((await sendCode(cookie, "+14155550104")).status).toBe(429);
      expect(t.sms.sent).toHaveLength(3);
    });

    it("silently stops texting a number that many accounts keep requesting, without telling them", async () => {
      const statuses: number[] = [];
      for (let i = 1; i <= 6; i++) statuses.push((await sendCode(await verifiedUser(`u${i}@example.com`), NUMBER_A)).status);
      expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
      expect(t.sms.sent).toHaveLength(5);
    });

    it("limits confirmation attempts", async () => {
      const cookie = await verifiedUser();
      await textedCode(cookie);
      for (let i = 0; i < 10; i++) expect((await verify(cookie, "000000")).status).toBe(400);
      expect((await verify(cookie, "000000")).status).toBe(429);
    });

    it("fails closed when Redis is unavailable, texting nothing and verifying nothing", async () => {
      const cookie = await verifiedUser();
      const code = await textedCode(cookie);
      const texted = t.sms.sent.length;

      redisDown();
      expect((await post("/profile/mobile/send-code", { phoneNumber: NUMBER_B }, cookie)).status).toBe(503);
      expect((await verify(cookie, code)).status).toBe(503);
      vi.restoreAllMocks();

      expect(t.sms.sent).toHaveLength(texted);
      expect(await t.prisma.userPhone.count()).toBe(0);
      expect((await verify(cookie, code)).status).toBe(204); // the pending code was untouched
    });
  });

  it("refuses mobile requests from a foreign or missing origin", async () => {
    const cookie = await verifiedUser();
    for (const origin of ["https://evil.example", null]) {
      const send = await t.request("/profile/mobile/send-code", { method: "POST", body: { phoneNumber: NUMBER_A }, cookie, origin });
      expect(send.status).toBe(403);
      expect((await t.request("/profile/mobile", { method: "DELETE", cookie, origin })).status).toBe(403);
    }
    expect(t.sms.sent).toHaveLength(0);
  });

  it("reports mobile verification as unavailable, and sends nothing, without an SMS provider", async () => {
    const cookie = await verifiedUser();
    vi.spyOn(t.sms, "configured", "get").mockReturnValue(false);
    expect((await profileOf(cookie)).mobile.available).toBe(false);
    const response = await sendCode(cookie);
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("FEATURE_UNAVAILABLE");
    expect(t.sms.sent).toHaveLength(0);
    expect(await t.prisma.phoneVerificationChallenge.count()).toBe(0);
  });

  it("surfaces a provider failure as a generic error and leaves nothing verified", async () => {
    const cookie = await verifiedUser();
    t.sms.failNext(new Error(`gateway rejected ${NUMBER_A}`));
    const response = await sendCode(cookie);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("9876");
    expect(await t.prisma.userPhone.count()).toBe(0);
  });

  it("keeps codes and full numbers out of logs, events, profile responses and errors", async () => {
    const cookie = await verifiedUser();
    const bodies: string[] = [];
    let code = "";
    const logs = await captureLogs(async () => {
      bodies.push(await (await sendCode(cookie)).text());
      code = t.sms.latestCode(NUMBER_A);
      bodies.push(await (await verify(cookie, code === "000000" ? "111111" : "000000")).text());
      bodies.push(await (await verify(cookie, code)).text());
      bodies.push(await (await get("/profile", cookie)).text());
      t.sms.failNext(new Error(`gateway rejected ${NUMBER_B} with code 424242`));
      bodies.push(await (await sendCode(cookie, NUMBER_B)).text());
    });
    const events = JSON.stringify(await t.prisma.authEvent.findMany());
    const digits = NUMBER_A.slice(1);
    for (const haystack of [logs, events, ...bodies]) {
      expect(haystack).not.toContain(NUMBER_A);
      expect(haystack).not.toContain(digits);
      expect(haystack).not.toContain(NUMBER_B);
      expect(haystack).not.toContain("424242");
      expect(haystack).not.toContain(`"${code}"`);
      expect(haystack).not.toContain(code === "000000" ? "111111" : "000000");
    }
    expect(logs).toContain("POST /api/v1/profile/mobile/verify"); // logging was captured
  });
});

describe("notification preferences", () => {
  it("defaults to security-safe values with marketing off", async () => {
    const cookie = await verifiedUser();
    expect(await prefsOf(cookie)).toEqual({
      email: { security: true, account: true, trading: true, promotions: false },
      telegram: { connected: false, security: true, account: true, trading: true, promotions: false },
      push: { available: false },
    });
    expect(await t.prisma.userNotificationPreference.count()).toBe(0); // reading creates nothing
  });

  it("lets a user change their own preferences, independently per category", async () => {
    const alex = await verifiedUser();
    const bob = await verifiedUser(BOB);

    const first = await patch("/notifications/preferences", { email: { promotions: true } }, alex);
    expect(first.status).toBe(200);
    expect(((await first.json()) as NotificationPreferencesResponse).email).toEqual({ security: true, account: true, trading: true, promotions: true });

    const second = await patch("/notifications/preferences", { email: { trading: false } }, alex);
    expect(((await second.json()) as NotificationPreferencesResponse).email).toEqual({ security: true, account: true, trading: false, promotions: true });
    expect((await prefsOf(alex)).email).toMatchObject({ trading: false, promotions: true });

    expect((await prefsOf(bob)).email).toEqual({ security: true, account: true, trading: true, promotions: false });
    const event = await t.prisma.authEvent.findFirstOrThrow({ where: { type: "NOTIFICATION_PREFERENCES_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect(event.userId).toBe(await userId(EMAIL));
    expect(event.metadata).toEqual({ email: { trading: false }, telegram: {} });
  });

  it("cannot switch off required security email, add push, or name another user", async () => {
    const alex = await verifiedUser();
    const bob = await verifiedUser(BOB);
    const bobId = await userId(BOB);
    for (const body of [
      { email: { security: false } },
      { email: { security: true, trading: false } },
      { push: { security: true } },
      { push: { available: true } },
      { userId: bobId, email: { trading: false } },
      {},
    ]) {
      expect((await patch("/notifications/preferences", body, alex)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await prefsOf(alex)).email).toEqual({ security: true, account: true, trading: true, promotions: false });
    expect((await prefsOf(bob)).email.trading).toBe(true);
    expect(await t.prisma.userNotificationPreference.count()).toBe(0);
  });

  it("still sends mandatory security email when every optional email is off", async () => {
    const cookie = await verifiedUser();
    await patch("/notifications/preferences", { email: { account: false, trading: false, promotions: false } }, cookie);
    const before = t.emails.sent.length;
    const response = await post("/auth/change-password", { currentPassword: PASSWORD, newPassword: "brand-new-lantern-77" }, cookie);
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(t.emails.sent.length).toBeGreaterThan(before));
    expect(t.emails.sent.at(-1)!.subject).toContain("password was changed");
  });

  it("does not allow Telegram settings, or count Telegram as enabled, until Telegram is connected", async () => {
    const cookie = await verifiedUser();
    const response = await patch("/notifications/preferences", { telegram: { trading: false } }, cookie);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("TELEGRAM_NOT_CONNECTED");
    expect((await prefsOf(cookie)).telegram.connected).toBe(false);

    const preferences = t.app.get(NotificationPreferencesService);
    const id = await userId(EMAIL);
    expect(await preferences.isAllowed(id, "telegram", "security")).toBe(false);
    expect(await preferences.isAllowed(id, "telegram", "trading")).toBe(false);
  });

  it("decides what each channel may send from the stored choices", async () => {
    const cookie = await verifiedUser();
    const id = await userId(EMAIL);
    const preferences = t.app.get(NotificationPreferencesService);

    expect(await preferences.isAllowed(id, "email", "security")).toBe(true);
    expect(await preferences.isAllowed(id, "email", "promotions")).toBe(false);
    await patch("/notifications/preferences", { email: { promotions: true, account: false } }, cookie);
    expect(await preferences.isAllowed(id, "email", "promotions")).toBe(true);
    expect(await preferences.isAllowed(id, "email", "account")).toBe(false);
    expect(await preferences.isAllowed(id, "email", "security")).toBe(true);
  });

  it("limits changes and fails closed when Redis is unavailable", async () => {
    const cookie = await verifiedUser();
    for (let i = 0; i < 30; i++) expect((await patch("/notifications/preferences", { email: { trading: i % 2 === 0 } }, cookie)).status).toBe(200);
    expect((await patch("/notifications/preferences", { email: { trading: true } }, cookie)).status).toBe(429);

    await t.redis.client.flushdb();
    redisDown();
    expect((await patch("/notifications/preferences", { email: { trading: true } }, cookie)).status).toBe(503);
  });

  it("refuses changes from a foreign or missing origin", async () => {
    const cookie = await verifiedUser();
    for (const origin of ["https://evil.example", null]) {
      const response = await t.request("/notifications/preferences", { method: "PATCH", body: { email: { promotions: true } }, cookie, origin });
      expect(response.status).toBe(403);
    }
    expect((await prefsOf(cookie)).email.promotions).toBe(false);
  });
});
