import { cx } from "@repo/utils";

/** Placeholder for content that is loading. Size it with className to match the final content. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded-sm bg-surface-muted", className)} />;
}
