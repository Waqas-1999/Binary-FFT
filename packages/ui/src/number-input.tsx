"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { IconButton } from "./icon-button.tsx";
import { Input, type InputProps } from "./input.tsx";

export interface NumberInputProps
  extends Omit<InputProps, "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step" | "trailing"> {
  value?: string;
  defaultValue?: string;
  /** Receives the raw text so partial input such as "1." is preserved while typing. */
  onValueChange?: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Show − / + buttons for touch-friendly adjustment. */
  stepper?: boolean;
}

function decimals(step: number): number {
  return step.toString().split(".")[1]?.length ?? 0;
}

/**
 * Numeric text field. Uses a text input with a decimal keyboard instead of type="number",
 * which accepts exponents and changes value on scroll.
 */
export function NumberInput({
  value,
  defaultValue = "",
  onValueChange,
  min,
  max,
  step = 1,
  stepper = false,
  disabled,
  label,
  ...props
}: NumberInputProps) {
  const [internal, setInternal] = useState(defaultValue);
  const current = value ?? internal;
  const allowNegative = min === undefined || min < 0;
  const pattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;

  const update = (next: string) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };

  const stepBy = (direction: 1 | -1) => {
    const parsed = Number.parseFloat(current);
    let next = (Number.isNaN(parsed) ? (min ?? 0) : parsed) + direction * step;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    update(next.toFixed(decimals(step)));
  };

  const parsed = Number.parseFloat(current);
  const atMin = min !== undefined && !Number.isNaN(parsed) && parsed <= min;
  const atMax = max !== undefined && !Number.isNaN(parsed) && parsed >= max;

  return (
    <Input
      type="text"
      inputMode={step % 1 === 0 && !allowNegative ? "numeric" : "decimal"}
      autoComplete="off"
      label={label}
      value={current}
      disabled={disabled}
      onChange={(event) => {
        if (pattern.test(event.target.value)) update(event.target.value);
      }}
      className="tabular-nums"
      {...props}
      trailing={
        stepper && (
          <span className="flex items-center">
            <IconButton
              label={`Decrease ${label}`}
              icon={<Minus />}
              onClick={() => stepBy(-1)}
              disabled={disabled || atMin}
              className="size-10"
            />
            <IconButton
              label={`Increase ${label}`}
              icon={<Plus />}
              onClick={() => stepBy(1)}
              disabled={disabled || atMax}
              className="size-10"
            />
          </span>
        )
      }
    />
  );
}
