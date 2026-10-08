import type { ApiErrorResponse, NotificationPreferencesResponse, ProfileResponse, TelegramLinkResponse } from "@repo/types";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "../../auth/tokens.ts";
import { createTestApp, sessionCookie, type TestApp } from "../../test/test-app.ts";
import { TEST_TELEGRAM_TOKEN, TEST_TELEGRAM_WEBHOOK_SECRET } from "../../test/test-env.ts";
import { TelegramService } from "./telegram.service.ts";

const EMAIL = "alex@example.com";
const BOB = "bob@example.com";
const PASSWORD = "calm-river-sunrise-42";
const ALEX_TG = 555_000_111;
const BOB_TG = 777_000_222;

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

const post = (path: string, body?: unknown, cookie?: string) => t.request(path, { method: "POST", body: body ?? {}, cookie });
const patch = (path: string, body: unknown, cookie?: string) => t.request(path, { method: "PATCH", body, cookie });
const del = (path: string, cookie?: string) => t.request(path, { method: "DELETE", cookie });
const get = (path: string, cookie?: string) => t.request(path, { cookie });
const errorCode = async (response: Response) => ((await response.json()) as ApiErrorResponse).code;
const profileOf = async (cookie: string) => (await (await get("/profile", cookie)).json()) as ProfileResponse;

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

/** Asks for a Telegram link as the signed-in user and returns the one-time token inside it. */
async function linkToken(cookie: string): Promise<string> {
  const response = await post("/profile/telegram/link", undefined, cookie);
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as TelegramLinkResponse;
  return new URL(url).searchParams.get("start")!;
}

/** What Telegram posts when someone opens the bot link and presses Start. */
const startUpdate = (token: string, from = ALEX_TG, overrides: Record<string, unknown> = {}) => ({
  update_id: Math.floor(Math.random() * 1e9),
  message: {
    message_id: 1,
    from: { id: from, is_bot: false, first_name: "Someone", username: "someone_else" },
    chat: { id: from, type: "private" },
    date: Math.floor(Date.now() / 1000),
    text: `/start ${token}`,
    ...overrides,
  },
});

/** Telegram calls the webhook server to server: no cookie, no browser Origin, only the secret header. */
const webhook = (body: unknown, secret: string | null = TEST_TELEGRAM_WEBHOOK_SECRET) =>
  t.request("/telegram/webhook", {
    method: "POST",
    body,
    origin: null,
    headers: secret === null ? {} : { "x-telegram-bot-api-secret-token": secret },
  });

async function connect(cookie: string, from = ALEX_TG): Promise<void> {
  const response = await webhook(startUpdate(await linkToken(cookie), from));
  expect(response.status).toBe(200);
}

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

describe("starting a Telegram connection", () => {
  it("needs a signed-in user", async () => {
    expect((await post("/profile/telegram/link")).status).toBe(401);
    expect(await t.prisma.telegramLinkToken.count()).toBe(0);
  });

  it("needs a recent authentication", async () => {
    const cookie = await verifiedUser();
    await ageAuthentication(cookie, 30);
    const response = await post("/profile/telegram/link", undefined, cookie);
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("REAUTHENTICATION_REQUIRED");
    expect(await t.prisma.telegramLinkToken.count()).toBe(0);
  });

  it("returns a bot deep link with a random, hashed, short-lived, single-use token", async () => {
    const cookie = await verifiedUser();
    const response = await post("/profile/telegram/link", undefined, cookie);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as TelegramLinkResponse;

    const url = new URL(body.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://t.me/binery_test_bot");
    const token = url.searchParams.get("start")!;
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(body.expiresInSeconds).toBe(600);
    expect(Object.keys(body).sort()).toEqual(["expiresInSeconds", "url"]);

    const row = await t.prisma.telegramLinkToken.findFirstOrThrow();
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.userId).toBe(await userId(EMAIL));
    expect(row.consumedAt).toBeNull();
    expect(Math.abs(row.expiresAt.getTime() - (Date.now() + 600_000))).toBeLessThan(10_000);

    const second = await linkToken(cookie);
    expect(second).not.toBe(token);
    expect(new Set([token, second, await linkToken(cookie)]).size).toBe(3);
  });

  it("never exposes the bot token or webhook secret", async () => {
    const cookie = await verifiedUser();
    const responses = [await post("/profile/telegram/link", undefined, cookie), await get("/profile", cookie), await get("/notifications/preferences", cookie)];
    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toContain(TEST_TELEGRAM_TOKEN);
      expect(text).not.toContain(TEST_TELEGRAM_TOKEN.split(":")[1]!);
      expect(text).not.toContain(TEST_TELEGRAM_WEBHOOK_SECRET);
    }
  });

  it("only the newest link works", async () => {
    const cookie = await verifiedUser();
    const first = await linkToken(cookie);
    const second = await linkToken(cookie);
    await webhook(startUpdate(first));
    expect(await t.prisma.telegramConnection.count()).toBe(0);
    await webhook(startUpdate(second));
    expect(await t.prisma.telegramConnection.count()).toBe(1);
  });

  it("is refused once Telegram is connected", async () => {
    const cookie = await verifiedUser();
    await connect(cookie);
    const response = await post("/profile/telegram/link", undefined, cookie);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("TELEGRAM_ALREADY_CONNECTED");
  });

  it("limits how often a link can be requested", async () => {
    const cookie = await verifiedUser();
    for (let i = 0; i < 5; i++) expect((await post("/profile/telegram/link", undefined, cookie)).status).toBe(200);
    const limited = await post("/profile/telegram/link", undefined, cookie);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("fails closed when Redis is unavailable", async () => {
    const cookie = await verifiedUser();
    vi.spyOn(t.redis.client, "multi").mockImplementation(() => {
      throw new Error("redis down");
    });
    expect((await post("/profile/telegram/link", undefined, cookie)).status).toBe(503);
    expect(await t.prisma.telegramLinkToken.count()).toBe(0);
  });

  it("refuses requests from a foreign or missing origin", async () => {
    const cookie = await verifiedUser();
    for (const origin of ["https://evil.example", null]) {
      expect((await t.request("/profile/telegram/link", { method: "POST", body: {}, cookie, origin })).status).toBe(403);
      expect((await t.request("/profile/telegram", { method: "DELETE", cookie, origin })).status).toBe(403);
    }
    expect(await t.prisma.telegramLinkToken.count()).toBe(0);
  });

  it("is reported unavailable, and does nothing, when Telegram is not configured", async () => {
    const cookie = await verifiedUser();
    vi.spyOn(t.app.get(TelegramService), "available", "get").mockReturnValue(false);
    expect((await profileOf(cookie)).telegram.available).toBe(false);
    const response = await post("/profile/telegram/link", undefined, cookie);
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("FEATURE_UNAVAILABLE");
    expect(await t.prisma.telegramLinkToken.count()).toBe(0);
    expect((await webhook(startUpdate("x".repeat(43)))).status).toBe(404);
    // The rest of the profile keeps working.
    expect((await patch("/profile", { displayName: "Still works" }, cookie)).status).toBe(200);
  });
});

describe("the Telegram webhook", () => {
  it("accepts only calls that carry the shared secret, with no cookie or browser origin", async () => {
    const cookie = await verifiedUser();
    const token = await linkToken(cookie);
    for (const secret of [null, "", "wrong-secret-wrong-secret", `${TEST_TELEGRAM_WEBHOOK_SECRET}x`, TEST_TELEGRAM_WEBHOOK_SECRET.slice(1)]) {
      const response = await webhook(startUpdate(token), secret);
      expect(response.status, String(secret)).toBe(403);
    }
    expect(await t.prisma.telegramConnection.count()).toBe(0);
    expect((await t.prisma.telegramLinkToken.findFirstOrThrow()).consumedAt).toBeNull();
    expect(t.telegram.messages).toHaveLength(0);

    expect((await webhook(startUpdate(token))).status).toBe(200);
    expect(await t.prisma.telegramConnection.count()).toBe(1);
  });

  it("is the only browser-less POST: ordinary routes still need a trusted origin", async () => {
    const cookie = await verifiedUser();
    const response = await t.request("/profile/telegram/link", {
      method: "POST",
      body: {},
      cookie,
      origin: null,
      headers: { "x-telegram-bot-api-secret-token": TEST_TELEGRAM_WEBHOOK_SECRET },
    });
    expect(response.status).toBe(403);
  });

  it("connects the account that created the link, identified by Telegram's numeric id", async () => {
    const cookie = await verifiedUser();
    await connect(cookie);

    const connection = await t.prisma.telegramConnection.findFirstOrThrow();
    expect(connection).toMatchObject({ userId: await userId(EMAIL), telegramUserId: String(ALEX_TG), chatId: String(ALEX_TG) });
    expect(Object.keys(connection).sort()).toEqual(["chatId", "connectedAt", "id", "telegramUserId", "userId"]); // no username stored
    expect((await t.prisma.telegramLinkToken.findFirstOrThrow()).consumedAt).not.toBeNull();
    expect((await profileOf(cookie)).telegram.connected).toBe(true);
    expect(t.telegram.messages).toHaveLength(1);
    expect(t.telegram.messages[0]).toMatchObject({ chatId: String(ALEX_TG) });
    expect(t.telegram.messages[0]!.text).toContain("Connected");
    expect(await t.prisma.authEvent.count({ where: { type: "TELEGRAM_LINK_STARTED" } })).toBe(1);
    const linked = await t.prisma.authEvent.findFirstOrThrow({ where: { type: "TELEGRAM_LINKED" } });
    expect(linked.userId).toBe(await userId(EMAIL));
    expect(JSON.stringify(linked)).not.toContain(String(ALEX_TG));
  });

  it("does not use the Telegram username as identity", async () => {
    const alex = await verifiedUser();
    const bob = await verifiedUser(BOB);
    const sameName = { from: { id: 0, first_name: "X", username: "shared_username" } };
    await webhook(startUpdate(await linkToken(alex), ALEX_TG, { from: { ...sameName.from, id: ALEX_TG } }));
    await webhook(startUpdate(await linkToken(bob), BOB_TG, { from: { ...sameName.from, id: BOB_TG } }));
    expect(await t.prisma.telegramConnection.count()).toBe(2); // same username, different people
    expect(JSON.stringify(await t.prisma.telegramConnection.findMany())).not.toContain("shared_username");
  });

  it("binds the link to the user who asked for it, whatever the message or body claims", async () => {
    const alex = await verifiedUser();
    const bob = await verifiedUser(BOB);
    const alexId = await userId(EMAIL);
    const bobsToken = await linkToken(bob);
    await linkToken(alex);

    // Someone holding Bob's link, claiming to be Alex everywhere they can.
    const update = { ...startUpdate(bobsToken, ALEX_TG), userId: alexId, user_id: alexId, email: EMAIL };
    update.message.text = `/start ${bobsToken}`;
    await webhook(update);

    const connection = await t.prisma.telegramConnection.findFirstOrThrow();
    expect(connection.userId).toBe(await userId(BOB));
    expect((await profileOf(alex)).telegram.connected).toBe(false);
    expect((await profileOf(bob)).telegram.connected).toBe(true);
  });

  it("rejects expired, unknown, malformed and replayed links", async () => {
    const cookie = await verifiedUser();

    const expired = await linkToken(cookie);
    await t.prisma.telegramLinkToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await webhook(startUpdate(expired));
    expect(t.telegram.messages.at(-1)!.text).toContain("expired");

    for (const text of ["/start", "/start short", `/start ${"A".repeat(43)}`, `/start ${"é".repeat(43)}`, "hello", `/start ${expired} extra`]) {
      await webhook(startUpdate("x", ALEX_TG, { text }));
    }
    expect(await t.prisma.telegramConnection.count()).toBe(0);

    const fresh = await linkToken(cookie);
    await webhook(startUpdate(fresh));
    expect(await t.prisma.telegramConnection.count()).toBe(1);

    // The same token from a different Telegram account cannot be replayed.
    const before = t.telegram.messages.length;
    await webhook(startUpdate(fresh, BOB_TG));
    expect(await t.prisma.telegramConnection.count()).toBe(1);
    expect(t.telegram.messages.slice(before).map((message) => message.chatId)).toEqual([String(BOB_TG)]);
    expect(t.telegram.messages.at(-1)!.text).toContain("expired");
  });

  it("treats a repeated delivery of a link that already worked as a no-op", async () => {
    const cookie = await verifiedUser();
    const update = startUpdate(await linkToken(cookie));
    await webhook(update);
    const messages = t.telegram.messages.length;
    expect((await webhook(update)).status).toBe(200);
    expect(await t.prisma.telegramConnection.count()).toBe(1);
    expect(t.telegram.messages).toHaveLength(messages); // no confusing "expired" after a success
  });

  it("lets exactly one of several simultaneous deliveries connect", async () => {
    const cookie = await verifiedUser();
    const token = await linkToken(cookie);
    const results = await Promise.all(Array.from({ length: 6 }, () => webhook(startUpdate(token))));
    expect(results.every((response) => response.status === 200)).toBe(true);
    expect(await t.prisma.telegramConnection.count()).toBe(1);
    expect(await t.prisma.authEvent.count({ where: { type: "TELEGRAM_LINKED" } })).toBe(1);
  });

  it("never moves or merges a Telegram account that already belongs to another user", async () => {
    const alex = await verifiedUser();
    const bob = await verifiedUser(BOB);
    await connect(alex, ALEX_TG);

    await webhook(startUpdate(await linkToken(bob), ALEX_TG)); // Bob tries with Alex's Telegram
    const connection = await t.prisma.telegramConnection.findFirstOrThrow();
    expect(connection.userId).toBe(await userId(EMAIL));
    expect(await t.prisma.telegramConnection.count()).toBe(1);
    expect((await profileOf(bob)).telegram.connected).toBe(false);
    expect((await profileOf(alex)).telegram.connected).toBe(true);

    expect(t.telegram.messages.at(-1)!.text).toContain("already connected");
    const conflict = await t.prisma.authEvent.findFirstOrThrow({ where: { type: "TELEGRAM_LINK_CONFLICT" } });
    expect(conflict.userId).toBe(await userId(BOB));
    // The conflicting link is spent, so it cannot be retried with a different account.
    expect((await t.prisma.telegramLinkToken.findMany({ where: { userId: await userId(BOB) } })).every((row) => row.consumedAt)).toBe(true);
  });

  it("ignores group chats, bots, other chat types and garbage", async () => {
    const cookie = await verifiedUser();
    const token = await linkToken(cookie);
    await webhook(startUpdate(token, ALEX_TG, { chat: { id: -100123, type: "supergroup" } }));
    await webhook(startUpdate(token, ALEX_TG, { from: { id: ALEX_TG, is_bot: true } }));
    await webhook(startUpdate(token, ALEX_TG, { from: undefined }));
    for (const garbage of [{}, [], { message: "x" }, { message: null }, { message: { chat: {} } }, { message: { from: { id: "1" }, chat: { id: 1, type: "private" }, text: `/start ${token}` } }]) {
      expect((await webhook(garbage)).status).toBe(200);
    }
    expect(await t.prisma.telegramConnection.count()).toBe(0);
    expect((await t.prisma.telegramLinkToken.findFirstOrThrow()).consumedAt).toBeNull();
  });

  it("does not let a disabled user connect", async () => {
    const cookie = await verifiedUser();
    const token = await linkToken(cookie);
    await t.prisma.user.updateMany({ data: { status: "DISABLED" } });
    await webhook(startUpdate(token));
    expect(await t.prisma.telegramConnection.count()).toBe(0);
  });

  it("keeps the connection when the bot's confirmation message cannot be delivered", async () => {
    const cookie = await verifiedUser();
    const token = await linkToken(cookie);
    t.telegram.failNext(new Error("telegram down"));
    expect((await webhook(startUpdate(token))).status).toBe(200);
    expect(await t.prisma.telegramConnection.count()).toBe(1);
  });

  it("does not make Telegram a way to sign in", async () => {
    const cookie = await verifiedUser();
    await connect(cookie);
    const response = await webhook(startUpdate("x".repeat(43), ALEX_TG, { text: "/login" }));
    expect(response.status).toBe(200);
    expect(sessionCookie(response)).toBeUndefined();
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(await t.prisma.session.count()).toBe(1); // only the signup session
  });
});

describe("disconnecting Telegram", () => {
  it("needs a signed-in user and a recent authentication", async () => {
    expect((await del("/profile/telegram")).status).toBe(401);
    const cookie = await verifiedUser();
    await connect(cookie);
    await ageAuthentication(cookie, 30);
    const stale = await del("/profile/telegram", cookie);
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("REAUTHENTICATION_REQUIRED");
    expect(await t.prisma.telegramConnection.count()).toBe(1);

    expect((await post("/auth/reauthenticate", { password: PASSWORD }, cookie)).status).toBe(204);
    expect((await del("/profile/telegram", cookie)).status).toBe(204);
  });

  it("removes the connection, records it, tells the chat, and leaves sign-in untouched", async () => {
    const cookie = await verifiedUser();
    await connect(cookie);
    expect((await del("/profile/telegram", cookie)).status).toBe(204);

    expect(await t.prisma.telegramConnection.count()).toBe(0);
    expect((await profileOf(cookie)).telegram.connected).toBe(false);
    expect((await t.prisma.authEvent.findFirstOrThrow({ where: { type: "TELEGRAM_UNLINKED" } })).userId).toBe(await userId(EMAIL));
    expect(t.telegram.messages.at(-1)!.text).toContain("no longer connected");
    expect((await t.request("/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } })).status).toBe(200);
    expect((await get("/auth/session", cookie)).status).toBe(200);
  });

  it("reports an unconnected account, and only ever touches the caller's own connection", async () => {
    const alex = await verifiedUser();
    const bob = await verifiedUser(BOB);
    await connect(alex, ALEX_TG);

    const response = await del("/profile/telegram", bob);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("TELEGRAM_NOT_CONNECTED");
    expect(await t.prisma.telegramConnection.count()).toBe(1);
  });

  it("allows connecting again afterwards, and the freed Telegram account can go to someone else", async () => {
    const alex = await verifiedUser();
    const bob = await verifiedUser(BOB);
    await connect(alex, ALEX_TG);
    await del("/profile/telegram", alex);
    await connect(bob, ALEX_TG);
    expect((await t.prisma.telegramConnection.findFirstOrThrow()).userId).toBe(await userId(BOB));
  });

  it("limits disconnects and fails closed when Redis is unavailable", async () => {
    const cookie = await verifiedUser();
    for (let i = 0; i < 10; i++) expect((await del("/profile/telegram", cookie)).status).toBe(409);
    expect((await del("/profile/telegram", cookie)).status).toBe(429);
    await t.redis.client.flushdb();
    vi.spyOn(t.redis.client, "multi").mockImplementation(() => {
      throw new Error("redis down");
    });
    expect((await del("/profile/telegram", cookie)).status).toBe(503);
  });
});

describe("Telegram and notification preferences", () => {
  it("unlocks Telegram preferences only while connected", async () => {
    const cookie = await verifiedUser();
    await connect(cookie);
    const response = await patch("/notifications/preferences", { telegram: { promotions: true, trading: false } }, cookie);
    expect(response.status).toBe(200);
    expect(((await response.json()) as NotificationPreferencesResponse).telegram).toEqual({
      connected: true,
      security: true,
      account: true,
      trading: false,
      promotions: true,
    });

    await del("/profile/telegram", cookie);
    const after = (await (await get("/notifications/preferences", cookie)).json()) as NotificationPreferencesResponse;
    expect(after.telegram.connected).toBe(false);
    expect((await patch("/notifications/preferences", { telegram: { trading: true } }, cookie)).status).toBe(409);
  });
});

describe("secrets", () => {
  it("keeps the bot token, webhook secret and link tokens out of logs, events and responses", async () => {
    const bodies: string[] = [];
    const tokens: string[] = [];
    const logs = await captureLogs(async () => {
      const cookie = await verifiedUser();
      const first = await linkToken(cookie);
      tokens.push(first);
      bodies.push(await (await webhook(startUpdate(first), "wrong-secret-wrong-secret")).text());
      bodies.push(await (await webhook(startUpdate(first))).text());
      bodies.push(await (await webhook(startUpdate(first, BOB_TG))).text());
      t.telegram.failNext(new Error(`failed https://api.telegram.org/bot${TEST_TELEGRAM_TOKEN}/sendMessage`));
      bodies.push(await (await del("/profile/telegram", cookie)).text());
      bodies.push(await (await get("/profile", cookie)).text());
      const second = await linkToken(cookie);
      tokens.push(second);
      bodies.push(await (await post("/profile/telegram/link", undefined, cookie)).text());
    });

    const events = JSON.stringify(await t.prisma.authEvent.findMany());
    const secrets = [TEST_TELEGRAM_TOKEN, TEST_TELEGRAM_TOKEN.split(":")[1]!, TEST_TELEGRAM_WEBHOOK_SECRET, "wrong-secret-wrong-secret", ...tokens];
    for (const secret of secrets) {
      for (const haystack of [logs, events, ...bodies]) expect(haystack).not.toContain(secret);
    }
    expect(logs).toContain("POST /api/v1/telegram/webhook"); // logging was captured
  });
});
