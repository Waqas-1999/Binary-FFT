import { describe, expect, it } from "vitest";
import { deviceKey, plainIp, summarizeUserAgent } from "./user-agent.ts";

describe("summarizeUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Chrome", "Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0", "Edge", "Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0", "Firefox", "macOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15", "Safari", "macOS"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1", "Safari", "iOS"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "Chrome", "Android"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0", "Firefox", "Linux"],
  ])("summarizes %s", (ua, browser, os) => {
    expect(summarizeUserAgent(ua)).toEqual({ browser, os });
  });

  it("copes with missing or odd values and reveals no versions", () => {
    expect(summarizeUserAgent(undefined)).toEqual({ browser: "Unknown browser", os: "Unknown device" });
    expect(summarizeUserAgent("curl/8.0")).toEqual({ browser: "Unknown browser", os: "Unknown device" });
    expect(JSON.stringify(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.6099.109"))).not.toMatch(/\d/);
  });

  it("keys devices by browser and OS only", () => {
    expect(deviceKey("Mozilla/5.0 (Windows NT 10.0) Chrome/119.0.0.0 Safari/537.36")).toBe(
      deviceKey("Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120.0.0.0 Safari/537.36"),
    );
  });
});

describe("plainIp", () => {
  it("drops a /32 suffix and keeps null", () => {
    expect(plainIp("203.0.113.9/32")).toBe("203.0.113.9");
    expect(plainIp("::1")).toBe("::1");
    expect(plainIp(null)).toBeNull();
  });
});
