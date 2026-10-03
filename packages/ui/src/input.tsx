import { ChevronDown, CircleAlert } from "lucide-react";
import { useId, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes } from "react";
import { cx } from "@repo/utils";
import { Spinner } from "./spinner.tsx";

export interface FieldProps {
  /** Always required: placeholders are not labels. Use `hideLabel` only when context makes it obvious. */
  label: string;
  hideLabel?: boolean;
  hint?: ReactNode;
  /** User-facing validation message. Marks the control invalid. */
  error?: string;
}

const controlClasses =
  "transition-control w-full min-h-12 rounded-md border border-border-strong bg-surface px-3.5 text-body text-text-primary placeholder:text-text-muted hover:border-text-muted focus:border-brand focus:outline-none focus:ring-3 focus:ring-brand/25 aria-invalid:border-danger aria-invalid:focus:ring-danger/25 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-text-muted";

/** Label, hint and error wiring shared by every form control. */
function Field({
  id,
  label,
  hideLabel,
  hint,
  error,
  className,
  children,
}: FieldProps & { id: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cx("text-body-small font-medium text-text-primary", hideLabel && "sr-only")}>
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-caption text-text-secondary">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-caption font-medium text-danger-text">
          <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, { hint, error }: FieldProps): string | undefined {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export interface InputProps extends FieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Shows a spinner, e.g. while validating or searching. */
  loading?: boolean;
  /** Decorative icon inside the start of the field. */
  leading?: ReactNode;
  /** Interactive element inside the end of the field, e.g. a visibility toggle. */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
  fieldClassName?: string;
}

/** Text input with label, hint, error, loading and adornment support. Base for the other inputs. */
export function Input({
  label,
  hideLabel,
  hint,
  error,
  loading = false,
  leading,
  trailing,
  id: idProp,
  className,
  fieldClassName,
  ...props
}: InputProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;

  return (
    <Field id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} className={fieldClassName}>
      <div className="relative flex items-center">
        {leading && (
          <span aria-hidden="true" className="pointer-events-none absolute left-3.5 text-text-muted [&>svg]:size-4.5">
            {leading}
          </span>
        )}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { label, hint, error })}
          aria-busy={loading || undefined}
          className={cx(controlClasses, leading ? "pl-10" : undefined, trailing || loading ? "pr-12" : undefined, className)}
          {...props}
        />
        {(trailing || loading) && (
          <span className="absolute right-1 flex items-center text-text-secondary">
            {loading ? <Spinner size="sm" label="Loading" className="mr-3" /> : trailing}
          </span>
        )}
      </div>
    </Field>
  );
}

export interface SelectProps extends FieldProps, SelectHTMLAttributes<HTMLSelectElement> {
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  /** Shown as a disabled first option when nothing is selected. */
  placeholder?: string;
  fieldClassName?: string;
}

/** Native select: best keyboard, screen reader and mobile picker support for free. */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  options,
  placeholder,
  id: idProp,
  className,
  fieldClassName,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;

  return (
    <Field id={id} label={label} hideLabel={hideLabel} hint={hint} error={error} className={fieldClassName}>
      <div className="relative flex items-center">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { label, hint, error })}
          className={cx(controlClasses, "cursor-pointer appearance-none pr-10 has-[option[value='']:checked]:text-text-muted", className)}
          defaultValue={props.value === undefined && placeholder ? "" : undefined}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 size-4.5 text-text-secondary" />
      </div>
    </Field>
  );
}
