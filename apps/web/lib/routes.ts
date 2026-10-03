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

/** True when `href` is the current page or one of its sub-pages. */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Dark is the primary trading experience; public pages default to light. */
export const themeConfig: ThemeConfig = {
  fallback: "light",
  routeDefaults: Object.values(appRoutes).map((path) => [path, "dark"]),
};
