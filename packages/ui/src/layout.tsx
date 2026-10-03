import type { HTMLAttributes } from "react";
import { cx } from "@repo/utils";

// Literal class names so Tailwind can detect them.
const gaps = { 0: "gap-0", 1: "gap-1", 2: "gap-2", 3: "gap-3", 4: "gap-4", 6: "gap-6", 8: "gap-8", 10: "gap-10" };
const aligns = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch", baseline: "items-baseline" };
const justifies = { start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between" };

type Gap = keyof typeof gaps;

export function Container({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)} {...props} />;
}

/** Vertical layout with consistent spacing. */
export function Stack({
  gap = 4,
  align = "stretch",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { gap?: Gap; align?: keyof typeof aligns }) {
  return <div className={cx("flex flex-col", gaps[gap], aligns[align], className)} {...props} />;
}

/** Horizontal layout with consistent spacing. */
export function Row({
  gap = 3,
  align = "center",
  justify = "start",
  wrap = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  gap?: Gap;
  align?: keyof typeof aligns;
  justify?: keyof typeof justifies;
  wrap?: boolean;
}) {
  return (
    <div
      className={cx("flex", gaps[gap], aligns[align], justifies[justify], wrap && "flex-wrap", className)}
      {...props}
    />
  );
}
