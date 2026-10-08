import type { OAuthLinkResult, OAuthLoginError } from "@repo/types";
import { safeRedirectPath } from "./routes";

/**
 * Where the browser goes to start Google sign-in. This is a full-page navigation to the API, which
 * redirects to Google. The API only accepts allowlisted internal routes for `next`; this keeps the
 * value to a same-site path as well.
 */
export function googleSignInHref(next?: string | null): string {
  return `/api/v1/auth/google?next=${encodeURIComponent(safeRedirectPath(next))}`;
}

/** Shown on the sign-in page after Google sends the user back with `?error=`. */
export const loginErrorMessages: Record<OAuthLoginError, string> = {
  oauth_failed: "We couldn't sign you in with Google. Please try again.",
  oauth_account_exists:
    "An account with that email already exists. Sign in with your email and password, then connect Google from your profile.",
  oauth_unavailable: "Google sign-in isn't available right now. Please try again in a few minutes.",
};

export const linkResultMessages: Record<OAuthLinkResult, { tone: "success" | "error"; text: string }> = {
  linked: { tone: "success", text: "Your Google account is connected." },
  conflict: {
    tone: "error",
    text: "That Google account is already connected to a different account. Try another one, or sign in with it instead.",
  },
  failed: { tone: "error", text: "We couldn't connect your Google account. Please try again." },
};

/** Looks a query value up in a message table; unknown values (anything an attacker can type) yield nothing. */
export function lookup<T>(table: Record<string, T>, key: string | null): T | undefined {
  return key !== null && Object.hasOwn(table, key) ? table[key] : undefined;
}
