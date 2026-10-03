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
});
