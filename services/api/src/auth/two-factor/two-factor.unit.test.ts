import { randomBytes } from "node:crypto";
import { recoveryCodeSchema } from "@repo/validation";
import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  matchTotp,
  otpauthUri,
  totpCode,
  totpStep,
} from "./totp.ts";
import { generateRecoveryCode, generateRecoveryCodes, hashRecoveryCode, RECOVERY_CODE_COUNT } from "./recovery-codes.ts";
import { SecretCipher } from "./secret-cipher.ts";

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890" with SHA-1.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP (RFC 6238)", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])("matches the published vector at T=%i", (seconds, expected) => {
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000), 8)).toBe(expected);
  });

  it("produces 6-digit codes with leading zeros kept", () => {
    expect(totpCode(RFC_SECRET, totpStep(1111111109 * 1000))).toBe("081804");
  });

  it("round-trips base32 and rejects invalid characters", () => {
    const bytes = randomBytes(20);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(() => base32Decode("not*base32")).toThrow();
  });

  it("generates 160-bit random secrets", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(50);
    for (const secret of secrets) {
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(base32Decode(secret)).toHaveLength(20);
    }
  });

  describe("matchTotp", () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);

    it("accepts the current step and one step either side, and nothing further", () => {
      expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(step);
      expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(step - 1);
      expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now)).toBe(step + 1);
      expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now)).toBeNull();
      expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now)).toBeNull();
    });

    it("rejects malformed input and other secrets' codes", () => {
      for (const bad of ["", "12345", "1234567", "abcdef", " 123456", "123456 "]) {
        expect(matchTotp(RFC_SECRET, bad, now)).toBeNull();
      }
      expect(matchTotp(RFC_SECRET, totpCode(generateTotpSecret(), step), now)).toBeNull();
    });
  });

  it("builds an otpauth URI from the given issuer and account", () => {
    const uri = new URL(otpauthUri({ secret: "ABCDEFGHIJKLMNOP", issuer: "Some Brand", account: "ada+test@example.com" }));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.hostname).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/Some Brand:ada+test@example.com");
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      secret: "ABCDEFGHIJKLMNOP",
      issuer: "Some Brand",
      algorithm: "SHA1",
      digits: "6",
      period: "30",
    });
  });
});

describe("SecretCipher", () => {
  const key = randomBytes(32);
  const cipher = new SecretCipher(key);

  it("round-trips and never stores plaintext", () => {
    const stored = cipher.encrypt("JBSWY3DPEHPK3PXP", "user-1");
    expect(stored).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(stored).not.toContain("JBSWY3DPEHPK3PXP");
    expect(cipher.decrypt(stored, "user-1")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("uses a fresh IV every time", () => {
    expect(cipher.encrypt("same", "ctx")).not.toBe(cipher.encrypt("same", "ctx"));
  });

  it("fails for another user, another key, or tampering", () => {
    const stored = cipher.encrypt("SECRET", "user-1");
    expect(() => cipher.decrypt(stored, "user-2")).toThrow();
    expect(() => new SecretCipher(randomBytes(32)).decrypt(stored, "user-1")).toThrow();

    const [version, iv, tag, ciphertext] = stored.split(".");
    const flipped = Buffer.from(ciphertext!, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => cipher.decrypt([version, iv, tag, flipped.toString("base64url")].join("."), "user-1")).toThrow();
    expect(() => cipher.decrypt("v2.a.b.c", "user-1")).toThrow("Unsupported");
    expect(() => cipher.decrypt("garbage", "user-1")).toThrow();
  });

  it("rejects keys of the wrong size", () => {
    expect(() => new SecretCipher(randomBytes(16))).toThrow();
  });
});

describe("recovery codes", () => {
  it("generates the configured number of distinct, well-formed codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
      expect(recoveryCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it("looks random: no collisions across many codes and every symbol appears", () => {
    const seen = new Set<string>();
    const symbols = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = generateRecoveryCode();
      seen.add(code);
      for (const char of code.replaceAll("-", "")) symbols.add(char);
    }
    expect(seen.size).toBe(2000);
    expect(symbols.size).toBe(32);
  });

  it("hashes the normalized form, so formatting differences don't matter", () => {
    const code = generateRecoveryCode();
    const normalized = recoveryCodeSchema.parse(code.toLowerCase());
    expect(hashRecoveryCode(normalized)).toBe(hashRecoveryCode(recoveryCodeSchema.parse(code)));
    expect(hashRecoveryCode(normalized)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(normalized)).not.toContain(normalized);
  });
});
