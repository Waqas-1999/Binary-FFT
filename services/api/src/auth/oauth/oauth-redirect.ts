/**
 * Internal routes Google sign-in may land on. Exact matches only: no query strings, hosts or
 * schemes, so a client-supplied `next` can never become an open redirect.
 */
const RETURN_PATHS: ReadonlySet<string> = new Set(["/trade", "/activity", "/wallet", "/profile"]);
const DEFAULT_RETURN_PATH = "/trade";

/** Returns `next` if it is an allowlisted internal route, otherwise the default. */
export function safeReturnPath(next: unknown): string {
  return typeof next === "string" && RETURN_PATHS.has(next) ? next : DEFAULT_RETURN_PATH;
}
