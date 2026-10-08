import type { RateLimit } from "../rate-limit/rate-limit.service.ts";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Profile, mobile, Telegram and notification settings in one place. */
export const profileConfig = {
  phone: {
    /** Lifetime of an SMS code. */
    codeTtlSeconds: 10 * MINUTE,
    /** Wrong codes allowed before the pending verification dies and a new code is needed. */
    maxAttempts: 5,
    /** Shown to the client so "Resend" can wait. Enforced by `phoneCooldown`. */
    resendAfterSeconds: MINUTE,
  },

  telegram: {
    /** Time to open the bot and press Start. */
    linkTtlSeconds: 10 * MINUTE,
  },

  rateLimits: {
    /** Display name and time zone changes. */
    profileUpdatePerUser: { limit: 20, windowSeconds: 15 * MINUTE },
    /** One SMS per minute per user... */
    phoneCooldown: { limit: 1, windowSeconds: MINUTE },
    /** ...and a handful per hour, so a stolen session can't turn the SMS bill into a weapon. */
    phoneCodesPerUser: { limit: 5, windowSeconds: HOUR },
    /**
     * Per destination number, across all users: stops one number being flooded from many accounts. As large
     * as the per-user cap so a person's own resends hit the visible per-user limit first. Silent, so it
     * can't reveal that other accounts asked for the same number.
     */
    phoneCodesPerNumber: { limit: 5, windowSeconds: HOUR },
    /** Switching to a different number (resending to the same one doesn't count). */
    phoneChangesPerUser: { limit: 3, windowSeconds: DAY },
    phoneVerifyPerUser: { limit: 10, windowSeconds: 15 * MINUTE },
    phoneRemovePerUser: { limit: 10, windowSeconds: HOUR },
    telegramLinkPerUser: { limit: 5, windowSeconds: HOUR },
    telegramUnlinkPerUser: { limit: 10, windowSeconds: HOUR },
    notificationPreferencesPerUser: { limit: 30, windowSeconds: 15 * MINUTE },
  } satisfies Record<string, RateLimit>,
} as const;
