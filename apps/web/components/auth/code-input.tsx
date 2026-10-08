"use client";

import { Input, type InputProps } from "@repo/ui";

/** Six-digit authenticator code field: numeric keypad on phones and one-time-code autofill. */
export function CodeInput(props: Omit<InputProps, "type" | "inputMode" | "autoComplete" | "maxLength">) {
  return (
    <Input
      inputMode="numeric"
      autoComplete="one-time-code"
      spellCheck={false}
      maxLength={7}
      placeholder="123 456"
      {...props}
    />
  );
}
