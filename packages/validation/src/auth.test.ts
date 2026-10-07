import { describe, expect, it } from "vitest";
import { loginSchema, normalizeEmail, signupSchema } from "./auth.ts";

const errorsFor = (input: unknown) => {
  const result = signupSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("normalizeEmail", () => {
  it("trims and lower-cases without changing the mailbox", () => {
    expect(normalizeEmail("  Alex.Morgan+Trade@Example.COM ")).toBe("alex.morgan+trade@example.com");
  });
});

describe("password policy", () => {
  it("accepts long passphrases without composition rules", () => {
    expect(errorsFor({ email: "alex@example.com", password: "correct horse battery staple" })).toEqual([]);
  });

  it.each([
    ["short", "Use at least 10 characters"],
    ["password123", "This password is too common. Try another."],
    ["aaaaaaaaaaaa", "Use a less repetitive password"],
    ["alexander-2026!", "Don't use your email in your password"],
  ])("rejects %s", (password, message) => {
    expect(errorsFor({ email: "alexander@example.com", password })).toContain(message);
  });

  it("ignores very short email names when checking for reuse", () => {
    expect(errorsFor({ email: "al@example.com", password: "always-calm-river" })).toEqual([]);
  });

  it("rejects passwords over the maximum length", () => {
    expect(errorsFor({ email: "alex@example.com", password: "x1".repeat(65) })).toContain(
      "Use 128 characters or fewer",
    );
  });
});

describe("loginSchema", () => {
  it("normalizes the email and does not apply the signup policy", () => {
    expect(loginSchema.parse({ email: " A@B.CO ", password: "short" })).toEqual({ email: "a@b.co", password: "short" });
  });
});
