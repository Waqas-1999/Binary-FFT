import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCode } from "./mobile.service.ts";
import { avatarFor } from "./profile.service.ts";
import { UnavailableSmsProvider, verificationSmsText } from "./sms/sms.provider.ts";
import { HttpTelegramClient } from "./telegram/telegram.client.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SMS codes", () => {
  it("are always six digits, keep leading zeros, and come from the CSPRNG rather than Math.random", () => {
    const random = vi.spyOn(Math, "random");
    const codes = Array.from({ length: 20_000 }, () => generateCode());
    expect(codes.every((code) => /^\d{6}$/.test(code))).toBe(true);
    expect(codes.some((code) => code.startsWith("0"))).toBe(true);
    expect(random).not.toHaveBeenCalled();
  });

  it("look random: no repeats in a small sample, and every digit appears in every position", () => {
    const codes = Array.from({ length: 5_000 }, () => generateCode());
    expect(new Set(codes).size).toBeGreaterThan(4_950); // ~12 expected birthday collisions in 10^6
    for (let position = 0; position < 6; position++) {
      expect(new Set(codes.map((code) => code[position])).size).toBe(10);
    }
  });
});

describe("avatarFor", () => {
  it.each([
    ["Alex Rivera", "alex@example.com", "AR"],
    ["alex", "alex@example.com", "A"],
    ["Ana María de la Cruz", "x@example.com", "AM"],
    ["山田 太郎", "x@example.com", "山太"],
    ["🎉 Party", "x@example.com", "🎉P"],
    [null, "zoe@example.com", "Z"],
    [null, "", "?"],
  ])("%j / %s -> %s", (name, email, expected) => {
    expect(avatarFor(name, email)).toEqual({ kind: "initials", text: expected });
  });
});

describe("SMS provider abstraction", () => {
  it("reports itself unavailable and never sends", async () => {
    const provider = new UnavailableSmsProvider();
    expect(provider.configured).toBe(false);
    await expect(provider.sendVerificationCode()).rejects.toThrow();
  });

  it("words the message with the brand, the code and the expiry, and nothing clickable", () => {
    const text = verificationSmsText({ code: "123456", expiresInMinutes: 10 });
    expect(text).toContain("BINERY FTT");
    expect(text).toContain("123456");
    expect(text).toContain("10 minutes");
    expect(text).not.toMatch(/https?:|www\./);
  });
});

describe("HttpTelegramClient", () => {
  const config = { botToken: "123456789:SECRET-token-value-0123456789", botUsername: "binery_bot", webhookSecret: "webhook-secret-0123456789" };

  it("posts a plain message to the Bot API", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new HttpTelegramClient(config).sendMessage("42", "hello");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${config.botToken}/sendMessage`);
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: "42", text: "hello" });
  });

  it("never lets the token escape in an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError(`fetch failed for https://api.telegram.org/bot${config.botToken}/sendMessage`))));
    const failure = await new HttpTelegramClient(config).sendMessage("42", "hi").catch((error: Error) => error);
    expect(String(failure)).not.toContain("SECRET-token");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
    const rejected = await new HttpTelegramClient(config).sendMessage("42", "hi").catch((error: Error) => error);
    expect(String(rejected)).toContain("403");
    expect(String(rejected)).not.toContain("SECRET-token");
  });
});
