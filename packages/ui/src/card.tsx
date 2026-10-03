import type { HTMLAttributes } from "react";
import { cx } from "@repo/utils";

/** A surface for grouping related content. Use sparingly; not every section needs a card. */
export function Card({
  elevated = false,
  padded = true,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { elevated?: boolean; padded?: boolean }) {
  return (
    <div
      className={cx(
        "rounded-lg border border-border",
        elevated ? "bg-surface-elevated shadow-raised" : "bg-surface",
        padded && "p-4 sm:p-6",
        className,
      )}
      {...props}
    />
  );
}
