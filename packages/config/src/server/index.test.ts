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
});
