import { z } from "zod";
import { twoFactorCodeSchema } from "./auth.ts";

// ---------------------------------------------------------------------------------------------
// Display name
// ---------------------------------------------------------------------------------------------

export const displayNameMaxLength = 50;

/** Control and line/paragraph separators, plus zero-width, direction-mark and bidirectional-override characters. */
function hasInvisibleOrControl(value: string): boolean {
  for (const character of value) {
    if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(character)) return true;
    const code = character.codePointAt(0) ?? 0;
    const zeroWidthOrMark = code === 0x200b || code === 0x200e || code === 0x200f || code === 0xfeff;
    const bidiOverride = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    if (zeroWidthOrMark || bidiOverride) return true;
  }
  return false;
}

/**
 * A name shown on the account. Not an identity: it is not unique, never used to find accounts, and
 * rendered as plain text only. Angle brackets are refused as defence in depth against markup.
 */
export const displayNameSchema = z
  .string({ error: "Enter a name" })
  .transform((value) => value.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .min(1, "Enter a name")
      .max(displayNameMaxLength, `Use ${displayNameMaxLength} characters or fewer`)
      // Checked before spaces are collapsed, so tabs, newlines and separators are refused, not rewritten.
      .refine((value) => !hasInvisibleOrControl(value), "Use letters, numbers and common punctuation only")
      .refine((value) => !/[<>]/.test(value), "Don't use < or > in your name"),
  )
  .transform((value) => value.replace(/ {2,}/g, " "));

// ---------------------------------------------------------------------------------------------
// Time zone
// ---------------------------------------------------------------------------------------------

/** An IANA zone such as "Asia/Kolkata", accepted only if the runtime knows it. */
export const timeZoneSchema = z
  .string({ error: "Choose a time zone" })
  .trim()
  .max(64, "Choose a time zone from the list")
  .refine(isKnownTimeZone, "Choose a time zone from the list");

function isKnownTimeZone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Only the fields present are changed. `null` clears an optional field back to the platform default. */
export const updateProfileSchema = z
  .strictObject({
    displayName: displayNameSchema.nullable().optional(),
    timeZone: timeZoneSchema.nullable().optional(),
  })
  .refine((value) => value.displayName !== undefined || value.timeZone !== undefined, "Nothing to update");

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ---------------------------------------------------------------------------------------------
// Mobile number
// ---------------------------------------------------------------------------------------------

const phoneHelp = "Enter your number with the country code, like +14155550123";

/**
 * Normalizes to E.164 ("+" and up to 15 digits, no leading zero in the country code). The country code
 * is mandatory because the platform is international; no country is assumed. Spaces, dots, dashes and
 * brackets are tolerated, and a leading "00" is read as "+".
 */
export function normalizePhoneNumber(input: string): string | null {
  const compact = input.normalize("NFKC").trim().replace(/[\s.\-()]/g, "");
  const international = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  return /^\+[1-9]\d{6,14}$/.test(international) ? international : null;
}

export const phoneNumberSchema = z
  .string({ error: phoneHelp })
  .max(32, phoneHelp)
  .transform((value, context) => {
    const normalized = normalizePhoneNumber(value);
    if (!normalized) {
      context.addIssue({ code: "custom", message: phoneHelp });
      return z.NEVER;
    }
    return normalized;
  });

export const requestPhoneCodeSchema = z.strictObject({ phoneNumber: phoneNumberSchema });
/** SMS codes have the same shape as authenticator codes: six digits, spaces tolerated. */
export const verifyPhoneCodeSchema = z.strictObject({ code: twoFactorCodeSchema });

/** "+14155550123" -> "+*******0123". Never shows more than the last four digits. */
export function maskPhoneNumber(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return `+${"*".repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

export type RequestPhoneCodeInput = z.infer<typeof requestPhoneCodeSchema>;
export type VerifyPhoneCodeInput = z.infer<typeof verifyPhoneCodeSchema>;

// ---------------------------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------------------------

/**
 * Categories a person can tune per channel. Security email is not in this list on purpose: it is
 * required and always sent. Push is not listed until push infrastructure exists.
 */
export interface NotificationPreferenceValues {
  email: { account: boolean; trading: boolean; promotions: boolean };
  telegram: { security: boolean; account: boolean; trading: boolean; promotions: boolean };
}

/** Central defaults. Marketing is opt-in; everything that protects the account is on. */
export const defaultNotificationPreferences: NotificationPreferenceValues = {
  email: { account: true, trading: true, promotions: false },
  telegram: { security: true, account: true, trading: true, promotions: false },
};

/** Unknown keys (e.g. `email.security`, `push`) are rejected rather than ignored, so nothing is silently dropped. */
export const updateNotificationPreferencesSchema = z
  .strictObject({
    email: z.strictObject({ account: z.boolean(), trading: z.boolean(), promotions: z.boolean() }).partial().optional(),
    telegram: z
      .strictObject({ security: z.boolean(), account: z.boolean(), trading: z.boolean(), promotions: z.boolean() })
      .partial()
      .optional(),
  })
  .refine(
    (value) => Object.keys(value.email ?? {}).length + Object.keys(value.telegram ?? {}).length > 0,
    "Nothing to update",
  );

export type UpdateNotificationPreferencesInput = z.infer<typeof updateNotificationPreferencesSchema>;
