"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { IconButton } from "./icon-button.tsx";
import { Input, type InputProps } from "./input.tsx";

export function PasswordInput(props: Omit<InputProps, "type" | "trailing">) {
  const [visible, setVisible] = useState(false);

  return (
    <Input
      type={visible ? "text" : "password"}
      autoComplete="current-password"
      spellCheck={false}
      {...props}
      trailing={
        <IconButton
          label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          icon={visible ? <EyeOff /> : <Eye />}
          onClick={() => setVisible((current) => !current)}
          disabled={props.disabled}
          className="size-10"
        />
      }
    />
  );
}
