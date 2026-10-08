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

  /**
   * Sensitive actions (disable two-factor, new recovery codes) need a strong authentication this
   * recent: a sign-in or an explicit reauthentication on the same session.
   */
  recentAuthSeconds: 10 * MINUTE,

  twoFactor: {
    /** Time to scan the QR code and enter the first code. An unconfirmed setup enables nothing. */
    setupTtlSeconds: 10 * MINUTE,
    /** Time to enter a code after the first factor passed. */
    challengeTtlSeconds: 5 * MINUTE,
    /** Wrong codes allowed on one challenge before it dies and the person signs in again. */
    maxChallengeAttempts: 5,
  },

  /** OAuth state, PKCE verifier and nonce live this long in Redis: enough to sign in at Google, no more. */
  oAuthStateTtlSeconds: 10 * MINUTE,

  rateLimits: {
    signupPerIp: { limit: 10, windowSeconds: HOUR },
    loginPerIp: { limit: 30, windowSeconds: 15 * MINUTE },
    /** Failed logins per email address, regardless of IP. */
    loginFailuresPerEmail: { limit: 10, windowSeconds: 15 * MINUTE },
    verifyPerIp: { limit: 20, windowSeconds: 15 * MINUTE },
    resendPerIp: { limit: 10, windowSeconds: HOUR },
    /** Emails sent to one address (verification or account notice). Silently capped. */
    emailsPerAddress: { limit: 3, windowSeconds: HOUR },
    /** Forgot-password requests per IP. Also bounds mail volume; a few legitimate retries fit. */
    forgotPasswordPerIp: { limit: 5, windowSeconds: HOUR },
    /** Reset emails sent to one address. Silently capped, like verification emails. */
    resetEmailsPerAddress: { limit: 3, windowSeconds: HOUR },
    /** Reset submissions per IP. Tokens are 256-bit, so this only limits abuse, not guessing. */
    resetPasswordPerIp: { limit: 10, windowSeconds: 15 * MINUTE },
    /** Starting setup is cheap but pointless to repeat; five a hour is generous. */
    twoFactorSetupPerUser: { limit: 5, windowSeconds: HOUR },
    /** Code guesses while enabling: 10^6 codes, so a few attempts per window are plenty. */
    twoFactorConfirmPerUser: { limit: 10, windowSeconds: 15 * MINUTE },
    /** Code guesses during sign-in, per IP and per account (an attacker needs the password first). */
    twoFactorVerifyPerIp: { limit: 30, windowSeconds: 15 * MINUTE },
    twoFactorVerifyPerUser: { limit: 10, windowSeconds: 15 * MINUTE },
    /** Disabling two-factor and regenerating recovery codes: both also verify a code. */
    twoFactorManagePerUser: { limit: 10, windowSeconds: 15 * MINUTE },
    /** Password re-checks for the signed-in user. */
    reauthPerUser: { limit: 10, windowSeconds: 15 * MINUTE },
    changePasswordPerUser: { limit: 5, windowSeconds: 15 * MINUTE },
    /** Revoking sessions: legitimate use is occasional. */
    sessionActionsPerUser: { limit: 30, windowSeconds: 15 * MINUTE },
    /** Starting Google sign-in or the callback, per IP. Each real attempt uses one of each. */
    googleOAuthPerIp: { limit: 20, windowSeconds: 15 * MINUTE },
    /** Starting Google linking per signed-in user; linking is rare, so this is deliberately low. */
    googleLinkPerUser: { limit: 5, windowSeconds: HOUR },
  } satisfies Record<string, RateLimit>,
} as const;

/** Production cookies use the __Host- prefix: Secure, Path=/, no Domain, so subdomains can't override them. */
export function sessionCookieName(isProduction: boolean): string {
  return isProduction ? "__Host-session" : "session";
}

/** Holds the pending second-factor challenge. Same `__Host-` rules as the session cookie. */
export function challengeCookieName(isProduction: boolean): string {
  return isProduction ? "__Host-login-challenge" : "login-challenge";
}

/** Ties an OAuth attempt to the browser that started it. Same `__Host-` rules as the session cookie. */
export function oauthBindingCookieName(isProduction: boolean): string {
  return isProduction ? "__Host-oauth-binding" : "oauth-binding";
}
