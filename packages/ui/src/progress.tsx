import { cx } from "@repo/utils";

/** Linear progress. Omit `value` for an indeterminate bar. */
export function Progress({
  label,
  value,
  max = 100,
  className,
}: {
  label: string;
  value?: number;
  max?: number;
  className?: string;
}) {
  const percent = value === undefined ? undefined : Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-surface-muted", className)}
    >
      <div
        className={cx(
          "h-full rounded-full bg-brand",
          percent === undefined ? "w-2/5 animate-indeterminate" : "transition-[width] duration-(--duration-slow) ease-standard",
        )}
        style={percent === undefined ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
