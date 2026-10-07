import type { RateLimit } from "../rate-limit/rate-limit.service.ts";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Authentication settings in one place. The password policy lives in @repo/validation. */
export const authConfig = {
  /** OWASP-recommended Argon2id baseline (19 MiB, 2 passes, 1 lane). */
  argon2: { memoryCost: 19_456, timeCost: 2, parallelism: 1 },

  session: {
    /** Absolute lifetime. */
    ttlSeconds: 30 * DAY,
    /** Signed out after this long without activity. */
    idleTimeoutSeconds: 7 * DAY,
    /** Throttles `last_active_at` writes to one per interval per session. */
    activityUpdateIntervalSeconds: 5 * MINUTE,
  },

  verificationToken: { ttlSeconds: 24 * HOUR },

  passwordResetToken: { ttlSeconds: HOUR },

  /** Short-lived, single-use OAuth state stored server-side (Redis-backed). 60-minute TTL. */
  oAuthStateTtlSeconds: 60 * MINUTE,

  /** Password-policy-compliant passphrase generous bounds. */
  passwordPolicy: { minLength: 10, maxLength: 128 } as const,

  rateLimits: {
    signupPerIp: { limit: 10, windowSeconds: HOUR },
    loginPerIp: { limit: 30, windowSeconds: 15 * MINUTE },
    /** Failed logins per email address, regardless of IP. */
    loginFailuresPerEmail: { limit: 10, windowSeconds: 15 * MINUTE },
    verifyPerIp: { limit: 20, windowSeconds: 15 * MINUTE },
    resendPerIp: { limit: 10, windowSeconds: HOUR },
    /** Emails sent to one address (verification or account notice). Silently capped. */
    emailsPerAddress: { limit: 3, windowSeconds: HOUR },
    /** Forgot-password requests per IP; fails closed if Redis unavailable. */
    forgotPasswordPerIp: { limit: 5, windowSeconds: HOUR },
    /** Reset-password attempts per IP; fails closed if Redis unavailable. */
    resetPasswordPerIp: { limit: 3, windowSeconds: 15 * MINUTE },
    /** Google OAuth initiation per IP; prevents replay / enumeration. */
    googleOAuthPerIp: { limit: 3, windowSeconds: 15 * MINUTE },
    /** Google linking initiation per authenticated user session. */
    googleLinkPerUser: { limit: 3, windowSeconds: HOUR },
  } satisfies Record<string, RateLimit>,
} as const;

/** Production cookies use the __Host- prefix: Secure, Path=/, no Domain, so subdomains can't override them. */
export function sessionCookieName(isProduction: boolean): string {
  return isProduction ? "__Host-session" : "session";
}
