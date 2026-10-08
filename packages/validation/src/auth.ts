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

/** True unless the password contains the email's name; "a@x.com" must not ban every password containing "a". */
export function passwordAvoidsEmail(email: string, password: string): boolean {
  const name = email.split("@")[0] ?? "";
  return name.length < 4 || !password.toLowerCase().includes(name);
}

export const signupSchema = z
  .object({ email: emailSchema, password: newPasswordSchema })
  .refine(({ email, password }) => passwordAvoidsEmail(email, password), {
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

/** A 6-digit authenticator code. Spaces are tolerated because apps display "123 456". */
export const twoFactorCodeSchema = z
  .string({ error: "Enter the 6-digit code" })
  .transform((value) => value.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code"));

/** Recovery codes are 16 characters from a 32-character alphabet, shown as xxxx-xxxx-xxxx-xxxx. */
export const recoveryCodeSchema = z
  .string({ error: "Enter a recovery code" })
  .transform((value) => value.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{16}$/, "Enter a valid recovery code"));

export const twoFactorCodeInputSchema = z.object({ code: twoFactorCodeSchema });
export const recoveryCodeInputSchema = z.object({ code: recoveryCodeSchema });

/** Strong re-check of the signed-in user. `password` is for accounts that have one. */
export const reauthenticateSchema = z.object({
  password: z.string().min(1, "Enter your password").max(passwordPolicy.maxLength).optional(),
  code: twoFactorCodeSchema.optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: "Enter your current password" }).min(1, "Enter your current password").max(passwordPolicy.maxLength),
    newPassword: newPasswordSchema,
    /** Required by the API when two-factor is on. */
    code: twoFactorCodeSchema.optional(),
  })
  .refine(({ currentPassword, newPassword }) => currentPassword !== newPassword, {
    message: "Choose a password you haven't used here before",
    path: ["newPassword"],
  });

export const forgotPasswordSchema = z.object({ email: emailSchema });

/** Reset tokens have the same format as verification tokens. */
export const resetPasswordSchema = z.object({
  token: z.string().regex(/^[\w-]{43}$/),
  password: newPasswordSchema,
});

export type ReauthenticateInput = z.infer<typeof reauthenticateSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
