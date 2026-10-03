import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@repo/utils";
import { Spinner } from "./spinner.tsx";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const base =
  "transition-control pressable focus-ring inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:not-aria-busy:opacity-50 aria-busy:cursor-progress";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-contrast hover:bg-brand-hover active:bg-brand-active",
  secondary:
    "border border-border-strong bg-surface-elevated text-text-primary shadow-raised hover:bg-surface-muted active:bg-surface-muted",
  tertiary: "bg-brand-soft text-brand-soft-text hover:bg-brand-soft/70",
  ghost: "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
  danger: "bg-danger-solid text-danger-contrast hover:bg-danger-solid/90 active:bg-danger-solid/80",
};

const sizes: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-body-small",
  lg: "min-h-13 px-6 text-body",
};

/** Classes for elements that should look like a button, such as links. */
export function buttonStyles({
  variant = "primary",
  size = "md",
  fullWidth = false,
}: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean } = {}): string {
  return cx(base, variants[variant], sizes[size], fullWidth && "w-full");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Shows a spinner in place of the label (keeping the width) and disables the button. */
  loading?: boolean;
  /** Icon shown before the label. */
  icon?: ReactNode;
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  icon,
  className,
  type = "button",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonStyles({ variant, size, fullWidth }), loading && "relative", className)}
      {...props}
    >
      {loading && <Spinner size="sm" label="Loading" className="absolute" />}
      <span className={cx("inline-flex items-center gap-2", loading && "invisible")}>
        {icon && (
          <span aria-hidden="true" className="inline-flex [&>svg]:size-4.5">
            {icon}
          </span>
        )}
        {children}
      </span>
    </button>
  );
}
