import { describe, expect, it } from "vitest";
import { changePasswordSchema, recoveryCodeSchema, twoFactorCodeSchema } from "./auth.ts";

describe("twoFactorCodeSchema", () => {
  it("accepts six digits, with or without the space authenticator apps show", () => {
    expect(twoFactorCodeSchema.parse("123456")).toBe("123456");
    expect(twoFactorCodeSchema.parse(" 123 456 ")).toBe("123456");
  });

  it.each(["", "12345", "1234567", "12a456", "１２３４５６", "123-456"])("rejects %j", (value) => {
    expect(twoFactorCodeSchema.safeParse(value).success).toBe(false);
  });
});

describe("recoveryCodeSchema", () => {
  it("normalizes case, dashes and spaces", () => {
    expect(recoveryCodeSchema.parse("abcd-efgh-jkmn-pqrs")).toBe("ABCDEFGHJKMNPQRS");
    expect(recoveryCodeSchema.parse(" ABCD EFGH JKMN PQRS ")).toBe("ABCDEFGHJKMNPQRS");
  });

  it.each(["", "ABCD-EFGH", "ABCD-EFGH-JKMN-PQRS-TUVW", "ABCD-EFGH-JKMN-PQR0", "ABCD-EFGH-JKMN-PQRI", "ABCD-EFGH-JKMN-PQR!"])(
    "rejects %j",
    (value) => {
      expect(recoveryCodeSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("changePasswordSchema", () => {
  const valid = { currentPassword: "calm-river-sunrise-42", newPassword: "brand-new-lantern-77" };

  it("applies the shared password policy to the new password", () => {
    expect(changePasswordSchema.safeParse(valid).success).toBe(true);
    expect(changePasswordSchema.safeParse({ ...valid, newPassword: "short" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...valid, newPassword: "password123" }).success).toBe(false);
  });

  it("rejects reusing the current password and requires it", () => {
    expect(changePasswordSchema.safeParse({ ...valid, newPassword: valid.currentPassword }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...valid, currentPassword: "" }).success).toBe(false);
  });
});
