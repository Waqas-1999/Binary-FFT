import { useId, type ReactNode } from "react";
import { cx } from "@repo/utils";

export interface SwitchProps {
  /** Always required: the visible name of the setting. */
  label: string;
  /** Supporting text under the label. */
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * On/off setting. A native checkbox with `role="switch"` underneath, so keyboard, focus and screen
 * reader behavior come for free. The state is also written out ("On" / "Off"), never colour alone, and
 * the whole row is a 44px-tall target.
 */
export function Switch({ label, description, checked, onCheckedChange, disabled = false, className }: SwitchProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={cx("flex min-h-11 items-center justify-between gap-4 py-1", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className={cx("text-body font-medium", disabled ? "text-text-secondary" : "text-text-primary")}>
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-caption text-text-secondary">
            {description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span aria-hidden="true" className="w-7 text-right text-caption font-medium text-text-secondary">
          {checked ? "On" : "Off"}
        </span>
        <span className="relative inline-flex h-7 w-12 items-center">
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={checked}
            disabled={disabled}
            aria-describedby={descriptionId}
            onChange={(event) => onCheckedChange(event.target.checked)}
            className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
          />
          <span
            aria-hidden="true"
            className={cx(
              "transition-control pointer-events-none absolute inset-0 rounded-full border border-border-strong peer-focus-visible:ring-3 peer-focus-visible:ring-brand/40",
              checked ? "border-brand bg-brand" : "bg-surface-muted",
              disabled && "opacity-50",
            )}
          />
          <span
            aria-hidden="true"
            className={cx(
              "transition-control pointer-events-none absolute left-0.5 size-5 rounded-full bg-surface-elevated shadow-raised",
              checked ? "translate-x-5" : "translate-x-0.5",
              disabled && "opacity-70",
            )}
          />
        </span>
      </div>
    </div>
  );
}
