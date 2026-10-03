import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@repo/utils";

const variants = {
  ghost: "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
  secondary: "border border-border-strong bg-surface-elevated text-text-primary hover:bg-surface-muted",
};

/** Icon-only button. `label` is required because the icon alone is not an accessible name. */
export function IconButton({
  label,
  icon,
  variant = "ghost",
  className,
  type = "button",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  label: string;
  icon: ReactNode;
  variant?: keyof typeof variants;
}) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(
        "transition-control pressable focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-md disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-5",
        variants[variant],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
}
