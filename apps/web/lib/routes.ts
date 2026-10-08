import type { ThemeConfig } from "@repo/ui";

/** Customer app destinations. Kept free of UI imports so any module can use it cheaply. */
export const appRoutes = {
  trade: "/trade",
  activity: "/activity",
  wallet: "/wallet",
  profile: "/profile",
} as const;

export const publicRoutes = {
  home: "/",
  blog: "/blog",
  faq: "/faq",
} as const;

export const authRoutes = {
  signup: "/signup",
  login: "/login",
  verifyEmail: "/verify-email",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
} as const;

/** True when `href` is the current page or one of its sub-pages. */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Returns `next` only if it is a same-site path, preventing open redirects after sign-in
 * (e.g. `//evil.example` or `https://evil.example`).
 */
export function safeRedirectPath(next: string | null | undefined, fallback: string = appRoutes.trade): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

/** Dark is the primary trading experience; public pages default to light. */
export const themeConfig: ThemeConfig = {
  fallback: "light",
  routeDefaults: Object.values(appRoutes).map((path) => [path, "dark"]),
};
