import { describe, expect, it } from "vitest";
import {
  defaultNotificationPreferences,
  displayNameSchema,
  maskPhoneNumber,
  normalizePhoneNumber,
  phoneNumberSchema,
  timeZoneSchema,
  updateNotificationPreferencesSchema,
  updateProfileSchema,
} from "./profile.ts";

describe("displayNameSchema", () => {
  it("trims, collapses whitespace and normalizes", () => {
    expect(displayNameSchema.parse("  Alex   Rivera \n")).toBe("Alex Rivera");
    expect(displayNameSchema.parse("Café")).toBe("Café");
  });

  it("accepts international names and emoji", () => {
    for (const name of ["Zoë", "山田 太郎", "Ananya Sharma", "Sam 🎉", "O'Brien-Smith"]) {
      expect(displayNameSchema.safeParse(name).success, name).toBe(true);
    }
  });

  it("rejects empty, too long, control, invisible, bidi and markup input", () => {
    const bad = ["", "   ", "a".repeat(51), "bad\u0000name", "a‮b", "zero​width", "line break", "<b>hi</b>", "a>b"];
    for (const name of bad) expect(displayNameSchema.safeParse(name).success, JSON.stringify(name)).toBe(false);
    expect(displayNameSchema.safeParse(42).success).toBe(false);
  });

  it("counts the limit after trimming", () => {
    expect(displayNameSchema.safeParse(` ${"a".repeat(50)} `).success).toBe(true);
  });
});

describe("timeZoneSchema", () => {
  it("accepts IANA zones and rejects everything else", () => {
    for (const zone of ["Asia/Kolkata", "America/New_York", "UTC", "Europe/London"]) expect(timeZoneSchema.safeParse(zone).success, zone).toBe(true);
    for (const zone of ["", "Mars/Olympus", "../etc/passwd", "x".repeat(65), "<script>"]) {
      expect(timeZoneSchema.safeParse(zone).success, zone).toBe(false);
    }
  });
});

describe("updateProfileSchema", () => {
  it("allows partial updates and clearing with null", () => {
    expect(updateProfileSchema.parse({ displayName: " Alex " })).toEqual({ displayName: "Alex" });
    expect(updateProfileSchema.parse({ displayName: null, timeZone: null })).toEqual({ displayName: null, timeZone: null });
  });

  it("rejects empty updates and any attempt to change anything else", () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    for (const extra of ["userNumber", "email", "userId", "id", "status", "phoneNumber"]) {
      expect(updateProfileSchema.safeParse({ displayName: "Alex", [extra]: "x" }).success, extra).toBe(false);
    }
  });
});

describe("phone numbers", () => {
  it.each([
    ["+919876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+1 (415) 555-0123", "+14155550123"],
    ["+44.7911.123456", "+447911123456"],
    ["00447911123456", "+447911123456"],
    ["  +49 151 23456789 ", "+4915123456789"],
    ["+１４１５５５５０１２３", "+14155550123"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each(["9876543210", "0987654321", "+0123456789", "+12345", "+1234567890123456", "+91abc4567890", "", "+", "++9198765432"])(
    "rejects %j",
    (input) => {
      expect(phoneNumberSchema.safeParse(input).success).toBe(false);
    },
  );

  it("is not India-only", () => {
    for (const number of ["+14155550123", "+447911123456", "+81312345678", "+5511987654321", "+27821234567"]) {
      expect(phoneNumberSchema.parse(number)).toBe(number);
    }
  });

  it("masks all but the last four digits", () => {
    expect(maskPhoneNumber("+919876543210")).toBe("+********3210");
    expect(maskPhoneNumber("+14155550123")).toBe("+*******0123");
    expect(maskPhoneNumber("+919876543210")).not.toContain("9876");
  });
});

describe("notification preferences", () => {
  it("defaults to security-safe values with marketing off", () => {
    expect(defaultNotificationPreferences.email.promotions).toBe(false);
    expect(defaultNotificationPreferences.telegram.promotions).toBe(false);
    expect(defaultNotificationPreferences.telegram.security).toBe(true);
  });

  it("accepts partial changes", () => {
    expect(updateNotificationPreferencesSchema.parse({ email: { promotions: true } })).toEqual({ email: { promotions: true } });
  });

  it("rejects mandatory, unknown and non-boolean settings", () => {
    for (const body of [
      {},
      { email: {} },
      { email: { security: false } },
      { push: { security: true } },
      { telegram: { marketing: true } },
      { email: { trading: "yes" } },
      { userId: "someone-else", email: { trading: false } },
    ]) {
      expect(updateNotificationPreferencesSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});
