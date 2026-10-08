import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./index.ts";

const validEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};

describe("loadServerConfig", () => {
  it("applies defaults and splits CORS origins", () => {
    const config = loadServerConfig({
      ...validEnv,
      API_CORS_ORIGINS: "http://a.test, http://b.test",
    });

    expect(config.app).toEqual({
      env: "development",
      isProduction: false,
      logLevel: "log",
      apiPort: 4000,
      corsOrigins: ["http://a.test", "http://b.test"],
      trustProxy: false,
      webAppUrl: "http://localhost:3000",
      allowedOrigins: ["http://localhost:3000", "http://a.test", "http://b.test"],
    });
    expect(config.database.url).toBe(validEnv.DATABASE_URL);
    expect(config.redis.url).toBe(validEnv.REDIS_URL);
  });

  it("reports every invalid variable", () => {
    const load = () => loadServerConfig({ REDIS_URL: "http://wrong", API_PORT: "abc" });

    expect(load).toThrow(/DATABASE_URL/);
    expect(load).toThrow(/API_PORT/);
    expect(load).toThrow(/REDIS_URL/);
  });

  it("loads SMTP settings for authenticated delivery", () => {
    const config = loadServerConfig({
      ...validEnv,
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "secret",
      SMTP_FROM: "Platform <noreply@example.com>",
    });

    expect(config.email.smtp).toEqual({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "mailer", pass: "secret" },
      from: "Platform <noreply@example.com>",
    });
  });

  it("allows empty SMTP placeholders in the development env template", () => {
    const config = loadServerConfig({
      ...validEnv,
      SMTP_HOST: "",
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      SMTP_FROM: "",
    });

    expect(config.email.smtp).toBeUndefined();
  });

  it("requires a complete SMTP configuration in production", () => {
    expect(() => loadServerConfig({ ...validEnv, NODE_ENV: "production" })).toThrow(/SMTP_HOST/);
    expect(() =>
      loadServerConfig({ ...validEnv, SMTP_HOST: "smtp.example.com" }),
    ).toThrow(/SMTP_FROM/);
    expect(() =>
      loadServerConfig({ ...validEnv, SMTP_HOST: "smtp.example.com", SMTP_FROM: "not an address" }),
    ).toThrow(/SMTP_FROM must be an address/);
    expect(() =>
      loadServerConfig({ ...validEnv, SMTP_USER: "mailer" }),
    ).toThrow(/SMTP_PASSWORD/);
  });

  it("loads Google OAuth settings only when all three are set", () => {
    expect(loadServerConfig(validEnv).google).toBeUndefined();
    expect(loadServerConfig({ ...validEnv, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_REDIRECT_URI: "" }).google).toBeUndefined();

    const google = {
      GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_REDIRECT_URI: "https://app.example.com/api/v1/auth/google/callback",
    };
    expect(loadServerConfig({ ...validEnv, ...google }).google).toEqual({
      clientId: google.GOOGLE_CLIENT_ID,
      clientSecret: google.GOOGLE_CLIENT_SECRET,
      redirectUri: google.GOOGLE_REDIRECT_URI,
    });
    expect(() => loadServerConfig({ ...validEnv, GOOGLE_CLIENT_ID: "id" })).toThrow(/must be configured together/);
    expect(() => loadServerConfig({ ...validEnv, ...google, GOOGLE_REDIRECT_URI: "not a url" })).toThrow(/GOOGLE_REDIRECT_URI/);
  });

  it("requires a valid two-factor encryption key, and in production requires one at all", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const production = {
      ...validEnv,
      NODE_ENV: "production",
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "noreply@example.com",
    };
    expect(loadServerConfig(validEnv).security.twoFactorKey).toBeUndefined();
    expect(loadServerConfig({ ...validEnv, TWO_FACTOR_ENCRYPTION_KEY: key }).security.twoFactorKey).toEqual(Buffer.alloc(32, 7));
    expect(() => loadServerConfig(production)).toThrow(/TWO_FACTOR_ENCRYPTION_KEY is required in production/);
    expect(loadServerConfig({ ...production, TWO_FACTOR_ENCRYPTION_KEY: key }).security.twoFactorKey).toHaveLength(32);
    for (const bad of ["short", Buffer.alloc(16).toString("base64"), Buffer.alloc(33).toString("base64"), "not base64!!"]) {
      expect(() => loadServerConfig({ ...validEnv, TWO_FACTOR_ENCRYPTION_KEY: bad })).toThrow(/exactly 32 bytes/);
    }
  });
  it("loads Telegram settings only when all three are set, and never requires them", () => {
    const production = { ...validEnv, NODE_ENV: "production", SMTP_HOST: "smtp.example.com", SMTP_FROM: "noreply@example.com", TWO_FACTOR_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
    expect(loadServerConfig(validEnv).telegram).toBeUndefined();
    expect(loadServerConfig(production).telegram).toBeUndefined(); // optional even in production
    expect(loadServerConfig({ ...validEnv, TELEGRAM_BOT_TOKEN: "", TELEGRAM_BOT_USERNAME: "", TELEGRAM_WEBHOOK_SECRET: "" }).telegram).toBeUndefined();

    const telegram = {
      TELEGRAM_BOT_TOKEN: "123456789:AAH-example_token-0123456789abcdef",
      TELEGRAM_BOT_USERNAME: "@binery_ftt_bot",
      TELEGRAM_WEBHOOK_SECRET: "a-long-random-webhook-secret_0123",
    };
    expect(loadServerConfig({ ...validEnv, ...telegram }).telegram).toEqual({
      botToken: telegram.TELEGRAM_BOT_TOKEN,
      botUsername: "binery_ftt_bot",
      webhookSecret: telegram.TELEGRAM_WEBHOOK_SECRET,
    });
    expect(() => loadServerConfig({ ...validEnv, TELEGRAM_BOT_TOKEN: telegram.TELEGRAM_BOT_TOKEN })).toThrow(/must be configured together/);
    expect(() => loadServerConfig({ ...validEnv, ...telegram, TELEGRAM_BOT_TOKEN: "not-a-token" })).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => loadServerConfig({ ...validEnv, ...telegram, TELEGRAM_BOT_USERNAME: "no" })).toThrow(/TELEGRAM_BOT_USERNAME/);
    expect(() => loadServerConfig({ ...validEnv, ...telegram, TELEGRAM_WEBHOOK_SECRET: "short" })).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    expect(() => loadServerConfig({ ...validEnv, ...telegram, TELEGRAM_WEBHOOK_SECRET: "has spaces and symbols!!!!!" })).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
  });
});
