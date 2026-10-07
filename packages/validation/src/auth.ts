import { z } from "zod";

/**
 * Password policy, shared by the API and the web forms.
 * Follows NIST SP 800-63B: length over complexity, no composition rules, and a block-list of
 * common passwords. Long passphrases are welcome.
 */
export const passwordPolicy = {
  minLength: 10,
  // Bounds hashing cost; generous enough for passphrases and password managers.
  maxLength: 128,
} as const;

// Small built-in list of the most common passwords meeting the length rule.
const commonPasswords = new Set([
  "1234567890",
  "12345678910",
  "123456789a",
  "0123456789",
  "1111111111",
  "0000000000",
  "qwertyuiop",
  "1q2w3e4r5t",
  "password12",
  "password123",
  "password1234",
  "passw0rd123",
  "iloveyou123",
  "qwerty1234",
  "qwerty12345",
  "abcdefghij",
  "abc1234567",
  "aaaaaaaaaa",
  "letmein1234",
  "welcome123",
  "football123",
  "baseball123",
  "princess123",
  "sunshine123",
  "trustno1234",
  "administrator",
]);

export const emailSchema = z
  .string({ error: "Enter your email" })
  .trim()
  .min(1, "Enter your email")
  .max(254, "Enter a valid email address")
  .pipe(z.email({ error: "Enter a valid email address" }))
  .transform(normalizeEmail);

/** Lower-cases and trims. Does not strip dots or "+tags": that is provider-specific. */
export function normalizeEmail(email: string): string {
  return email.trim().normalize("NFC").toLowerCase();
}

export const newPasswordSchema = z
  .string({ error: "Create a password" })
  .min(passwordPolicy.minLength, `Use at least ${passwordPolicy.minLength} characters`)
  .max(passwordPolicy.maxLength, `Use ${passwordPolicy.maxLength} characters or fewer`)
  .refine((password) => password.trim().length > 0, "Create a password")
  .refine((password) => !commonPasswords.has(password.toLowerCase()), "This password is too common. Try another.")
  .refine((password) => new Set(password).size > 2, "Use a less repetitive password");

export const signupSchema = z
  .object({ email: emailSchema, password: newPasswordSchema })
  .refine(({ email, password }) => {
    // Only meaningful for longer names; "a@x.com" must not ban every password containing "a".
    const name = email.split("@")[0] ?? "";
    return name.length < 4 || !password.toLowerCase().includes(name);
  }, {
    message: "Don't use your email in your password",
    path: ["password"],
  });

/** Login only checks presence and bounds; the policy is enforced at signup. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: "Enter your password" }).min(1, "Enter your password").max(passwordPolicy.maxLength),
});

/** Verification tokens are 32 random bytes, base64url-encoded (43 characters). */
export const verifyEmailSchema = z.object({
  token: z.string().regex(/^[\w-]{43}$/),
});

export const resendVerificationSchema = z.object({ email: emailSchema });

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
