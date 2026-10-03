import type { ReactNode } from "react";
import { cx } from "@repo/utils";

export type BadgeTone = "neutral" | "brand" | "success" | "danger" | "warning" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-text-secondary",
  brand: "bg-brand-soft text-brand-soft-text",
  success: "bg-success/12 text-success-text",
  danger: "bg-danger/12 text-danger-text",
  warning: "bg-warning/14 text-warning-text",
  info: "bg-info/12 text-info-text",
};

/** Short status label. Pair status tones with an icon or explicit wording, never color alone. */
export function Badge({
  tone = "neutral",
  icon,
  className,
  children,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex [&>svg]:size-3.5">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
