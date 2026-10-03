"use client";

import { cx } from "@repo/utils";
import { ArrowLeftRight, CandlestickChart, UserRound, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { appRoutes, isActivePath } from "../lib/routes";

export const appNavItems: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: appRoutes.trade, label: "Trade", icon: CandlestickChart },
  { href: appRoutes.activity, label: "Activity", icon: ArrowLeftRight },
  { href: appRoutes.wallet, label: "Wallet", icon: Wallet },
  { href: appRoutes.profile, label: "Profile", icon: UserRound },
];

/** Desktop and tablet: inline in the header. Active state uses weight, background and aria-current, not just color. */
export function TopNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {appNavItems.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "transition-control focus-ring flex min-h-11 items-center gap-2 rounded-sm px-3 text-body-small",
                  active
                    ? "bg-surface-muted font-semibold text-text-primary"
                    : "font-medium text-text-secondary hover:bg-surface-muted hover:text-text-primary",
                )}
              >
                <Icon aria-hidden="true" className={cx("size-4.5", active && "text-brand")} strokeWidth={active ? 2.25 : 2} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mobile: fixed bottom bar with icon + label. Active item gets an indicator bar and bold label. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {appNavItems.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "transition-control focus-ring relative flex min-h-16 flex-col items-center justify-center gap-1 text-caption -outline-offset-2",
                  active ? "font-semibold text-brand" : "font-medium text-text-secondary hover:text-text-primary",
                )}
              >
                {active && (
                  <span aria-hidden="true" className="absolute inset-x-6 top-0 h-0.5 rounded-b-full bg-brand" />
                )}
                <Icon aria-hidden="true" className="size-5.5" strokeWidth={active ? 2.25 : 1.75} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
