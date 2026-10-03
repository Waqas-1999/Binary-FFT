import { brand } from "@repo/config";
import { cx } from "@repo/utils";
import Link from "next/link";

/** Brand mark + short name. Inline SVG: no extra request, no layout shift, inherits theme colors. */
export function BrandLogo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cx("focus-ring -mx-1.5 flex min-h-11 items-center gap-2 rounded-sm px-1.5 text-h3 font-bold tracking-tight", className)}
    >
      <svg aria-hidden="true" viewBox="0 0 32 32" className="size-7 shrink-0">
        <rect width="32" height="32" rx="8" className="fill-brand" />
        <path
          d="M9 20.5 14 15l3.5 3.5L23 12"
          fill="none"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-brand-contrast"
        />
      </svg>
      {brand.shortName}
    </Link>
  );
}
