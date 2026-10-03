import { cx } from "@repo/utils";

const sizes = { sm: "size-4 border-2", md: "size-6 border-2", lg: "size-8 border-[3px]" };

/** For short actions. Use Skeleton for content that is loading. */
export function Spinner({
  label = "Loading",
  size = "md",
  className,
}: {
  label?: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span role="status" className={cx("inline-flex", className)}>
      <span
        aria-hidden="true"
        className={cx("animate-spin rounded-full border-current border-r-transparent opacity-80", sizes[size])}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
